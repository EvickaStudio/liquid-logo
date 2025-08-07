'use client';

import { liquidFragSource } from '@/app/hero/liquid-frag';
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { toast } from 'sonner';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let GIFEncoder: any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let quantize: any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let applyPalette: any;

// Bayer 4x4 matrix normalized to [-0.5, 0.5] for light ordered dithering
const BAYER_4X4 = new Float32Array([
  0, 8, 2, 10,
  12, 4, 14, 6,
  3, 11, 1, 9,
  15, 7, 13, 5,
]).map((v) => v / 16 - 0.5);

function ditherOrdered(rgba: Uint8Array, width: number, height: number, strength: number): Uint8Array {
  const out = new Uint8Array(rgba.length);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const t = BAYER_4X4[(y & 3) * 4 + (x & 3)];
      // apply a tiny offset per color channel; clamp into [0,255]
      for (let c = 0; c < 3; c++) {
        const v = rgba[i + c] + t * 255 * 0.02 * strength;
        out[i + c] = v < 0 ? 0 : v > 255 ? 255 : v;
      }
      out[i + 3] = rgba[i + 3];
    }
  }
  return out;
}

// uniform sampler2D u_image_texture;
// uniform float u_time;
// uniform float u_ratio;
// uniform float u_img_ratio;
// uniform float u_patternScale;
// uniform float u_refraction;
// uniform float u_edge;
// uniform float u_patternBlur;
// uniform float u_liquid;

const vertexShaderSource = `#version 300 es
precision mediump float;

in vec2 a_position;
out vec2 vUv;

void main() {
    vUv = .5 * (a_position + 1.);
    gl_Position = vec4(a_position, 0.0, 1.0);
}` as const;

export type ShaderParams = {
  patternScale: number;
  refraction: number;
  edge: number;
  patternBlur: number;
  liquid: number;
  speed: number;
};

export type CanvasExportOptions = {
  side: number;
  durationSec?: number;
  fps?: number;
  background: string; // css color or 'transparent'
};

export type CanvasHandle = {
  exportGIF: (options: CanvasExportOptions) => Promise<Blob>;
};

export const Canvas = forwardRef<CanvasHandle, { imageData: ImageData; params: ShaderParams; processing: boolean }>(
  ({ imageData, params, processing }, ref) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [gl, setGl] = useState<WebGL2RenderingContext | null>(null);
  const [uniforms, setUniforms] = useState<Record<string, WebGLUniformLocation>>({});
  /** Keeps track of how long we've been playing, fed into u_time */
  const totalAnimationTime = useRef(0);
  const lastRenderTime = useRef(0);

  function updateUniforms() {
    if (!gl || !uniforms) return;
    gl.uniform1f(uniforms.u_edge, params.edge);
    gl.uniform1f(uniforms.u_patternBlur, params.patternBlur);
    gl.uniform1f(uniforms.u_time, 0);
    gl.uniform1f(uniforms.u_patternScale, params.patternScale);
    gl.uniform1f(uniforms.u_refraction, params.refraction);
    gl.uniform1f(uniforms.u_liquid, params.liquid);
  }

  useEffect(() => {
    function initShader() {
      const canvas = canvasRef.current;
      const gl = canvas?.getContext('webgl2', {
        antialias: true,
        alpha: true,
      });
      if (!canvas || !gl) {
        toast.error('Failed to initialize shader. Does your browser support WebGL2?');
        return;
      }

      function createShader(gl: WebGL2RenderingContext, sourceCode: string, type: number) {
        const shader = gl.createShader(type);
        if (!shader) {
          toast.error('Failed to create shader');
          return null;
        }

        gl.shaderSource(shader, sourceCode);
        gl.compileShader(shader);

        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
          console.error('An error occurred compiling the shaders: ' + gl.getShaderInfoLog(shader));
          gl.deleteShader(shader);
          return null;
        }

        return shader;
      }

      const vertexShader = createShader(gl, vertexShaderSource, gl.VERTEX_SHADER);
      const fragmentShader = createShader(gl, liquidFragSource, gl.FRAGMENT_SHADER);
      const program = gl.createProgram();
      if (!program || !vertexShader || !fragmentShader) {
        toast.error('Failed to create program or shaders');
        return;
      }

      gl.attachShader(program, vertexShader);
      gl.attachShader(program, fragmentShader);
      gl.linkProgram(program);

      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
        console.error('Unable to initialize the shader program: ' + gl.getProgramInfoLog(program));
        return null;
      }

      function getUniforms(program: WebGLProgram, gl: WebGL2RenderingContext) {
        let uniforms: Record<string, WebGLUniformLocation> = {};
        let uniformCount = gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS);
        for (let i = 0; i < uniformCount; i++) {
          let uniformName = gl.getActiveUniform(program, i)?.name;
          if (!uniformName) continue;
          uniforms[uniformName] = gl.getUniformLocation(program, uniformName) as WebGLUniformLocation;
        }
        return uniforms;
      }
      const uniforms = getUniforms(program, gl);
      setUniforms(uniforms);

      // Vertex position
      const vertices = new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]);
      const vertexBuffer = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);

      gl.useProgram(program);
      // Enable blending for correct transparency
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

      const positionLocation = gl.getAttribLocation(program, 'a_position');
      gl.enableVertexAttribArray(positionLocation);

      gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);
      gl.vertexAttribPointer(positionLocation, 2, gl.FLOAT, false, 0, 0);

      setGl(gl);
    }

    initShader();
    updateUniforms();
  }, []);

  // Keep uniforms updated
  useEffect(() => {
    if (!gl || !uniforms) return;

    updateUniforms();
  }, [gl, params, uniforms]);

  // Render every frame
  useEffect(() => {
    if (!gl || !uniforms) return;

    let renderId: number;

    function render(currentTime: number) {
      const deltaTime = currentTime - lastRenderTime.current;
      lastRenderTime.current = currentTime;

      // Update the total animation time and time uniform
      totalAnimationTime.current += deltaTime * params.speed;
      gl!.uniform1f(uniforms.u_time, totalAnimationTime.current);
      // Draw!
      gl!.drawArrays(gl!.TRIANGLE_STRIP, 0, 4);
      // rAF
      renderId = requestAnimationFrame(render);
    }

    // Kick off the render loop
    lastRenderTime.current = performance.now();
    renderId = requestAnimationFrame(render);

    return () => {
      cancelAnimationFrame(renderId);
    };
  }, [gl, params.speed]);

  useEffect(() => {
    const canvasEl = canvasRef.current;
    if (!canvasEl || !gl || !uniforms) return;

    function resizeCanvas() {
      if (!canvasEl || !gl || !uniforms) return;
      const imgRatio = imageData.width / imageData.height;
      gl.uniform1f(uniforms.u_img_ratio, imgRatio);

      const side = 1000;
      canvasEl.width = side * devicePixelRatio;
      canvasEl.height = side * devicePixelRatio;
      gl.viewport(0, 0, canvasEl.height, canvasEl.height);
      gl.uniform1f(uniforms.u_ratio, 1);
      gl.uniform1f(uniforms.u_img_ratio, imgRatio);
    }

    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);

    return () => {
      window.removeEventListener('resize', resizeCanvas);
    };
  }, [gl, uniforms, imageData]);

  useEffect(() => {
    if (!gl || !uniforms) return;

    // Delete any existing texture first
    const existingTexture = gl.getParameter(gl.TEXTURE_BINDING_2D);
    if (existingTexture) {
      gl.deleteTexture(existingTexture);
    }

    const imageTexture = gl.createTexture();
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, imageTexture);

    // Set texture parameters before uploading the data
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    // Ensure power-of-two dimensions or use appropriate texture parameters
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);

    try {
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        gl.RGBA,
        imageData.width,
        imageData.height,
        0,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        imageData.data
      );

      gl.uniform1i(uniforms.u_image_texture, 0);
    } catch (e) {
      console.error('Error uploading texture:', e);
      toast.error('Failed to upload image texture');
    }

    return () => {
      // Cleanup texture when component unmounts or imageData changes
      if (imageTexture) {
        gl.deleteTexture(imageTexture);
      }
    };
  }, [gl, uniforms, imageData]);

  // Expose export method
  useImperativeHandle(ref, () => ({
    exportGIF: async ({ side, durationSec = 3, fps = 20, background }: CanvasExportOptions): Promise<Blob> => {
      // Lazy import encoder
      if (!GIFEncoder || !quantize || !applyPalette) {
        try {
          const mod = await import('gifenc');
          GIFEncoder = mod.GIFEncoder;
          quantize = mod.quantize;
          applyPalette = mod.applyPalette;
        } catch (exc) {
          toast.error('Failed to load GIF encoder');
          throw exc;
        }
      }

      const offscreen = document.createElement('canvas');
      offscreen.width = side;
      offscreen.height = side;
      const egl = offscreen.getContext('webgl2', { antialias: true, alpha: true });
      if (!egl) throw new Error('Failed to initialize WebGL2 for export');

      // compile program
      function createShader(glCtx: WebGL2RenderingContext, sourceCode: string, type: number) {
        const shader = glCtx.createShader(type);
        if (!shader) return null;
        glCtx.shaderSource(shader, sourceCode);
        glCtx.compileShader(shader);
        if (!glCtx.getShaderParameter(shader, glCtx.COMPILE_STATUS)) {
          glCtx.deleteShader(shader);
          return null;
        }
        return shader;
      }

      const vtx = createShader(
        egl,
        `#version 300 es\nprecision mediump float;\n in vec2 a_position; out vec2 vUv; void main(){ vUv=.5*(a_position+1.); gl_Position=vec4(a_position,0.,1.); }`,
        egl.VERTEX_SHADER
      );
      const frg = createShader(egl, liquidFragSource, egl.FRAGMENT_SHADER);
      const program = egl.createProgram();
      if (!program || !vtx || !frg) throw new Error('Failed to create export shader program');
      egl.attachShader(program, vtx);
      egl.attachShader(program, frg);
      egl.linkProgram(program);
      if (!egl.getProgramParameter(program, egl.LINK_STATUS)) throw new Error('Failed to link export shader');
      egl.useProgram(program);
      egl.enable(egl.BLEND);
      egl.blendFunc(egl.SRC_ALPHA, egl.ONE_MINUS_SRC_ALPHA);

      // geometry
      const vertices = new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]);
      const vb = egl.createBuffer();
      egl.bindBuffer(egl.ARRAY_BUFFER, vb);
      egl.bufferData(egl.ARRAY_BUFFER, vertices, egl.STATIC_DRAW);
      const posLoc = egl.getAttribLocation(program, 'a_position');
      egl.enableVertexAttribArray(posLoc);
      egl.vertexAttribPointer(posLoc, 2, egl.FLOAT, false, 0, 0);

      // uniforms
      const u_image_texture = egl.getUniformLocation(program, 'u_image_texture') as WebGLUniformLocation;
      const u_time = egl.getUniformLocation(program, 'u_time') as WebGLUniformLocation;
      const u_ratio = egl.getUniformLocation(program, 'u_ratio') as WebGLUniformLocation;
      const u_img_ratio = egl.getUniformLocation(program, 'u_img_ratio') as WebGLUniformLocation;
      const u_patternScale = egl.getUniformLocation(program, 'u_patternScale') as WebGLUniformLocation;
      const u_refraction = egl.getUniformLocation(program, 'u_refraction') as WebGLUniformLocation;
      const u_edge = egl.getUniformLocation(program, 'u_edge') as WebGLUniformLocation;
      const u_patternBlur = egl.getUniformLocation(program, 'u_patternBlur') as WebGLUniformLocation;
      const u_liquid = egl.getUniformLocation(program, 'u_liquid') as WebGLUniformLocation;

      // texture
      const tex = egl.createTexture();
      egl.activeTexture(egl.TEXTURE0);
      egl.bindTexture(egl.TEXTURE_2D, tex);
      egl.texParameteri(egl.TEXTURE_2D, egl.TEXTURE_MIN_FILTER, egl.LINEAR);
      egl.texParameteri(egl.TEXTURE_2D, egl.TEXTURE_MAG_FILTER, egl.LINEAR);
      egl.texParameteri(egl.TEXTURE_2D, egl.TEXTURE_WRAP_S, egl.CLAMP_TO_EDGE);
      egl.texParameteri(egl.TEXTURE_2D, egl.TEXTURE_WRAP_T, egl.CLAMP_TO_EDGE);
      egl.pixelStorei(egl.UNPACK_ALIGNMENT, 1);
      egl.texImage2D(
        egl.TEXTURE_2D,
        0,
        egl.RGBA,
        imageData.width,
        imageData.height,
        0,
        egl.RGBA,
        egl.UNSIGNED_BYTE,
        imageData.data
      );
      egl.uniform1i(u_image_texture, 0);

      // viewport & uniforms
      egl.viewport(0, 0, offscreen.width, offscreen.height);
      const imgRatio = imageData.width / imageData.height;
      egl.uniform1f(u_ratio, 1);
      egl.uniform1f(u_img_ratio, imgRatio);
      egl.uniform1f(u_patternScale, params.patternScale);
      egl.uniform1f(u_refraction, params.refraction);
      egl.uniform1f(u_edge, params.edge);
      egl.uniform1f(u_patternBlur, params.patternBlur);
      egl.uniform1f(u_liquid, params.liquid);

      // background clear
      function cssToRgba(css: string): [number, number, number, number] {
        if (css === 'transparent') return [0, 0, 0, 0];
        const c = document.createElement('canvas');
        c.width = c.height = 1;
        const ctx = c.getContext('2d')!;
        ctx.fillStyle = css;
        ctx.fillRect(0, 0, 1, 1);
        const d = ctx.getImageData(0, 0, 1, 1).data;
        return [d[0] / 255, d[1] / 255, d[2] / 255, 1];
      }
      const [cr, cg, cb, ca] = cssToRgba(background);
      egl.clearColor(cr, cg, cb, ca);

      // encoder
      // Choose a frame count based on requested fps & duration, but sample exactly one shader period
      // The shader period is 1000ms in u_time (since t = 0.001 * u_time and animation depends on mod 1)
      const totalFrames = Math.max(2, Math.round((durationSec ?? 3) * (fps ?? 20)));
      const tPeriodMs = 1000; // one seamless cycle
      const perFrameTimeMs = tPeriodMs / totalFrames; // ensures end returns to start
      // Playback delay: scale by current speed so perceived speed matches live preview
      const safeSpeed = Math.max(0.01, params.speed);
      const delayMs = Math.max(10, Math.round(perFrameTimeMs / safeSpeed));
      const encoder = GIFEncoder();

      const pixels = new Uint8Array(offscreen.width * offscreen.height * 4);
      const rowSize = offscreen.width * 4;
      const tmpRow = new Uint8Array(rowSize);
      const flipVert = (buf: Uint8Array) => {
        for (let y = 0; y < Math.floor(offscreen.height / 2); y++) {
          const top = y * rowSize;
          const bot = (offscreen.height - 1 - y) * rowSize;
          tmpRow.set(buf.subarray(top, top + rowSize));
          buf.copyWithin(top, bot, bot + rowSize);
          buf.set(tmpRow, bot);
        }
      };

      for (let i = 0; i < totalFrames; i++) {
        egl.clear(egl.COLOR_BUFFER_BIT);
        const timeMs = perFrameTimeMs * i;
        egl.uniform1f(u_time, timeMs);
        egl.drawArrays(egl.TRIANGLE_STRIP, 0, 4);
        egl.readPixels(0, 0, offscreen.width, offscreen.height, egl.RGBA, egl.UNSIGNED_BYTE, pixels);
        flipVert(pixels);
        // Use higher-quality RGB quantization to reduce banding/"lines"
        const palette = quantize(pixels, 256, { format: 'rgb565' });
        // Dither slightly when mapping to palette to hide quantization contours
        const index = applyPalette(ditherOrdered(pixels, offscreen.width, offscreen.height, 2), palette);
        // If transparent background requested, mark indices with low alpha as transparent index 0
        let transparent = false;
        if (background === 'transparent') {
          transparent = true;
          const transparentIndex = 0;
          for (let p = 0, q = 0; p < pixels.length; p += 4, q++) {
            const a = pixels[p + 3];
            if (a < 8) index[q] = transparentIndex;
          }
        }
        encoder.writeFrame(index, offscreen.width, offscreen.height, {
          palette,
          delay: delayMs,
          // Set loop on first frame
          ...(i === 0 ? { repeat: 0 } : {}),
          ...(transparent ? { transparent: true, transparentIndex: 0 } : {}),
        });
      }

      encoder.finish();
      const bytes: Uint8Array = encoder.bytes();
      return new Blob([bytes], { type: 'image/gif' });
    },
  }));

  return <canvas ref={canvasRef} className="block h-full w-full object-contain" />;
});

Canvas.displayName = 'Canvas';

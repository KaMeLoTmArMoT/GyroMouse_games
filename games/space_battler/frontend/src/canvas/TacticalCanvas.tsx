// React 2.5D Tactical Canvas Component with pan/zoom, time-scale execution, and rendering loop

import { useEffect, useRef } from "react";
import type { ClientCombatSimulation } from "../engine/simulation";
import { VisualEffectsManager } from "./effects";
import { renderProjectile } from "./projectileRenderer";
import { renderShip } from "./shipRenderer";

interface TacticalCanvasProps {
  sim: ClientCombatSimulation;
  speed: number;
  onStepRequest?: () => void;
  selectedShipId?: string | null;
  onSelectShip?: (shipId: string | null) => void;
}

export function TacticalCanvas({ sim, speed, selectedShipId }: TacticalCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const effectsRef = useRef<VisualEffectsManager>(new VisualEffectsManager());

  // Camera Pan & Zoom state
  const cameraRef = useRef<{ x: number; y: number; zoom: number }>({ x: 0, y: 0, zoom: 0.9 });
  const isDraggingRef = useRef(false);
  const dragStartRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });

  useEffect(() => {
    let animId: number;
    let lastTime = performance.now();

    const renderLoop = (now: number) => {
      const rawDt = (now - lastTime) / 1000;
      lastTime = now;
      const dt = Math.min(rawDt, 0.1); // Clamp against huge lag spikes

      // 1. Advance simulation if not paused
      if (speed > 0) {
        sim.update(dt * speed);
        effectsRef.current.update(dt * speed);
      }

      // 2. Clear & Draw Canvas
      const canvas = canvasRef.current;
      if (canvas) {
        const ctx = canvas.getContext("2d");
        if (ctx) {
          ctx.save();
          ctx.clearRect(0, 0, canvas.width, canvas.height);

          // Deep Space Dark Background
          ctx.fillStyle = "#05070f";
          ctx.fillRect(0, 0, canvas.width, canvas.height);

          // Camera Transformation (Center origin + Pan + Zoom)
          ctx.translate(
            canvas.width / 2 + cameraRef.current.x,
            canvas.height / 2 + cameraRef.current.y,
          );
          ctx.scale(cameraRef.current.zoom, cameraRef.current.zoom);

          // Draw Tactical Grid
          drawTacticalGrid(ctx);

          // Draw Laser Beams
          for (const beam of effectsRef.current.beams) {
            ctx.strokeStyle = beam.color;
            ctx.lineWidth = beam.width;
            ctx.beginPath();
            ctx.moveTo(beam.from[0], beam.from[1]);
            ctx.lineTo(beam.to[0], beam.to[1]);
            ctx.stroke();
          }

          // Draw Explosions / Particles
          for (const p of effectsRef.current.particles) {
            ctx.fillStyle = p.color;
            ctx.beginPath();
            ctx.arc(p.pos[0], p.pos[1], p.radius, 0, Math.PI * 2);
            ctx.fill();
          }

          // Draw Active Projectiles
          for (const proj of sim.projectiles) {
            renderProjectile(ctx, proj);
          }

          // Draw Ships & Rotating Turrets
          for (const ship of sim.ships) {
            renderShip(ctx, ship, ship.id === selectedShipId);
          }

          ctx.restore();
        }
      }

      animId = requestAnimationFrame(renderLoop);
    };

    animId = requestAnimationFrame(renderLoop);
    return () => cancelAnimationFrame(animId);
  }, [sim, speed, selectedShipId]);

  // Handle Resize
  useEffect(() => {
    const handleResize = () => {
      const canvas = canvasRef.current;
      if (canvas?.parentElement) {
        canvas.width = canvas.parentElement.clientWidth;
        canvas.height = canvas.parentElement.clientHeight;
      }
    };
    handleResize();
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  // Pan & Zoom Event Listeners
  const handleMouseDown = (e: React.MouseEvent) => {
    if (e.button === 0) {
      // Left click drag
      isDraggingRef.current = true;
      dragStartRef.current = { x: e.clientX, y: e.clientY };
    }
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (isDraggingRef.current) {
      const dx = e.clientX - dragStartRef.current.x;
      const dy = e.clientY - dragStartRef.current.y;
      cameraRef.current.x += dx;
      cameraRef.current.y += dy;
      dragStartRef.current = { x: e.clientX, y: e.clientY };
    }
  };

  const handleMouseUp = () => {
    isDraggingRef.current = false;
  };

  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const zoomFactor = e.deltaY < 0 ? 1.1 : 0.9;
    cameraRef.current.zoom = Math.max(0.3, Math.min(2.5, cameraRef.current.zoom * zoomFactor));
  };

  return (
    <div className="relative w-full h-full overflow-hidden select-none cursor-grab active:cursor-grabbing">
      <canvas
        ref={canvasRef}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onWheel={handleWheel}
        className="w-full h-full block"
      />

      {/* Floating Tactical Overlay Information */}
      <div className="absolute top-4 left-4 pointer-events-none flex flex-col gap-1 text-[11px] font-mono text-zinc-400 bg-zinc-950/70 p-2.5 rounded-lg border border-zinc-800/80 backdrop-blur-sm">
        <div>
          STATUS:{" "}
          <span className="text-cyan-400 font-semibold">
            {speed === 0 ? "SIM PAUSED" : "ENGAGED"}
          </span>
        </div>
        <div>TIME: {sim.timeElapsed.toFixed(1)}s</div>
        <div>
          SHIPS: {sim.ships.filter((s) => s.team === 0 && s.isAlive).length} Blue /{" "}
          {sim.ships.filter((s) => s.team === 1 && s.isAlive).length} Red
        </div>
        <div className="text-[10px] text-zinc-600 mt-1">Drag: Pan | Scroll: Zoom</div>
      </div>
    </div>
  );
}

function drawTacticalGrid(ctx: CanvasRenderingContext2D): void {
  const gridSize = 100;
  const radius = 1800;

  ctx.strokeStyle = "rgba(30, 41, 59, 0.4)"; // slate-800
  ctx.lineWidth = 1;

  ctx.beginPath();
  for (let x = -radius; x <= radius; x += gridSize) {
    ctx.moveTo(x, -radius);
    ctx.lineTo(x, radius);
  }
  for (let y = -radius; y <= radius; y += gridSize) {
    ctx.moveTo(-radius, y);
    ctx.lineTo(radius, y);
  }
  ctx.stroke();

  // Outer coordinate boundary circle
  ctx.strokeStyle = "rgba(56, 189, 248, 0.15)";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(0, 0, 1000, 0, Math.PI * 2);
  ctx.stroke();
}

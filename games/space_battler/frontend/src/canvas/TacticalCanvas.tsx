// React 2.5D Tactical Canvas Component with click/hover ship selection, pan/zoom, and live range cones

import { useEffect, useRef } from "react";
import { spaceAudio } from "../engine/audioEngine";
import type { ClientCombatSimulation } from "../engine/simulation";
import { VisualEffectsManager } from "./effects";
import { renderProjectile } from "./projectileRenderer";
import { renderShip } from "./shipRenderer";

interface TacticalCanvasProps {
  sim: ClientCombatSimulation;
  speed: number;
  selectedShipId?: string | null;
  onSelectShip?: (shipId: string | null) => void;
}

export function TacticalCanvas({ sim, speed, selectedShipId, onSelectShip }: TacticalCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const effectsRef = useRef<VisualEffectsManager>(new VisualEffectsManager());

  const cameraRef = useRef<{ x: number; y: number; zoom: number }>({ x: 0, y: 0, zoom: 0.85 });
  const isDraggingRef = useRef(false);
  const dragStartRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const hasDraggedRef = useRef(false);

  useEffect(() => {
    // Keep sound and visual effects on the same combat events.
    sim.onBeamFire = (from, to, color, width) => {
      effectsRef.current.addBeam(from, to, color, width, 0.16);
      spaceAudio.playWeapon("beam_laser");
    };
    sim.onFlakBurst = (pos) => {
      effectsRef.current.addFlakBurst(pos, 60);
      spaceAudio.playWeapon("point_defense");
    };
    sim.onProjectileFire = (type) => spaceAudio.playWeapon(type);
    sim.onShieldHit = (_pos, intensity) => spaceAudio.playShieldHit(intensity);
    sim.onShipDestroyed = (ship) => spaceAudio.playExplosion(ship);
    sim.onVictory = (winnerTeam) => spaceAudio.playVictory(winnerTeam);

    let animId: number;
    let lastTime = performance.now();

    const renderLoop = (now: number) => {
      const rawDt = (now - lastTime) / 1000;
      lastTime = now;
      const dt = Math.min(rawDt, 0.1);

      if (speed > 0) {
        sim.update(dt * speed);
        effectsRef.current.update(dt * speed);
      }

      const canvas = canvasRef.current;
      if (canvas) {
        const ctx = canvas.getContext("2d");
        if (ctx) {
          ctx.save();
          ctx.clearRect(0, 0, canvas.width, canvas.height);

          ctx.fillStyle = "#05070f";
          ctx.fillRect(0, 0, canvas.width, canvas.height);

          // Camera Transformation
          ctx.translate(
            canvas.width / 2 + cameraRef.current.x,
            canvas.height / 2 + cameraRef.current.y,
          );
          ctx.scale(cameraRef.current.zoom, cameraRef.current.zoom);

          drawTacticalGrid(ctx);

          // Draw Active Beams
          for (const beam of effectsRef.current.beams) {
            ctx.strokeStyle = beam.color;
            ctx.lineWidth = beam.width;
            ctx.beginPath();
            ctx.moveTo(beam.from[0], beam.from[1]);
            ctx.lineTo(beam.to[0], beam.to[1]);
            ctx.stroke();
          }

          // Draw Particles
          for (const p of effectsRef.current.particles) {
            ctx.fillStyle = p.color;
            ctx.beginPath();
            ctx.arc(p.pos[0], p.pos[1], p.radius, 0, Math.PI * 2);
            ctx.fill();
          }

          // Draw Expanding Flak Burst Shockwaves
          for (const burst of effectsRef.current.flakBursts) {
            const alpha = Math.max(0, burst.remainingDuration / burst.maxDuration);

            ctx.strokeStyle = `rgba(251, 146, 60, ${0.85 * alpha})`;
            ctx.lineWidth = 3;
            ctx.beginPath();
            ctx.arc(burst.pos[0], burst.pos[1], burst.radius, 0, Math.PI * 2);
            ctx.stroke();

            ctx.strokeStyle = `rgba(250, 204, 21, ${0.5 * alpha})`;
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.arc(burst.pos[0], burst.pos[1], burst.radius * 0.65, 0, Math.PI * 2);
            ctx.stroke();
          }

          // Draw Projectiles
          for (const proj of sim.projectiles) {
            renderProjectile(ctx, proj);
          }

          // Draw Ships
          for (const ship of sim.ships) {
            renderShip(ctx, ship, ship.id === selectedShipId);
          }

          ctx.restore();
        }
      }

      animId = requestAnimationFrame(renderLoop);
    };

    animId = requestAnimationFrame(renderLoop);
    return () => {
      cancelAnimationFrame(animId);
      sim.onBeamFire = null;
      sim.onFlakBurst = null;
      sim.onProjectileFire = undefined;
      sim.onShieldHit = undefined;
      sim.onShipDestroyed = undefined;
      sim.onVictory = undefined;
    };
  }, [sim, speed, selectedShipId]);

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

  const handleMouseDown = (e: React.MouseEvent) => {
    if (e.button === 0) {
      isDraggingRef.current = true;
      hasDraggedRef.current = false;
      dragStartRef.current = { x: e.clientX, y: e.clientY };
    }
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (isDraggingRef.current) {
      const dx = e.clientX - dragStartRef.current.x;
      const dy = e.clientY - dragStartRef.current.y;
      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
        hasDraggedRef.current = true;
      }
      cameraRef.current.x += dx;
      cameraRef.current.y += dy;
      dragStartRef.current = { x: e.clientX, y: e.clientY };
    }
  };

  const handleMouseUp = (e: React.MouseEvent) => {
    isDraggingRef.current = false;

    // Click selection (if not a pan drag)
    if (!hasDraggedRef.current && onSelectShip && canvasRef.current) {
      const rect = canvasRef.current.getBoundingClientRect();
      const clickX = e.clientX - rect.left;
      const clickY = e.clientY - rect.top;

      // Convert Screen Coords -> World Coords
      const worldX =
        (clickX - canvasRef.current.width / 2 - cameraRef.current.x) / cameraRef.current.zoom;
      const worldY =
        (clickY - canvasRef.current.height / 2 - cameraRef.current.y) / cameraRef.current.zoom;

      // Find nearest clicked ship
      let clickedShip: string | null = null;
      let minD = 50; // max click radius

      for (const ship of sim.ships) {
        if (!ship.isAlive) continue;
        const dx = ship.pos[0] - worldX;
        const dy = ship.pos[1] - worldY;
        const d = Math.sqrt(dx * dx + dy * dy);
        if (d < Math.max(ship.size * 1.5, minD)) {
          minD = d;
          clickedShip = ship.id;
        }
      }

      onSelectShip(clickedShip);
    }
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
        <div className="text-[10px] text-zinc-600 mt-1">
          Click ship to view telemetry | Drag to Pan
        </div>
      </div>
    </div>
  );
}

function drawTacticalGrid(ctx: CanvasRenderingContext2D): void {
  const gridSize = 100;
  const radius = 1800;

  ctx.strokeStyle = "rgba(30, 41, 59, 0.4)";
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

  ctx.strokeStyle = "rgba(56, 189, 248, 0.15)";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(0, 0, 1000, 0, Math.PI * 2);
  ctx.stroke();
}

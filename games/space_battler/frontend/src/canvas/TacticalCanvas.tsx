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
  const followRef = useRef(Boolean(selectedShipId));

  useEffect(() => {
    followRef.current = Boolean(selectedShipId);
  }, [selectedShipId]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target;
      if (
        e.key.toLowerCase() !== "f" ||
        e.repeat ||
        e.ctrlKey ||
        e.metaKey ||
        e.altKey ||
        (target instanceof HTMLElement &&
          (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)))
      ) {
        return;
      }
      const ship = sim.ships.find((s) => s.id === selectedShipId && s.isAlive);
      if (ship) {
        cameraRef.current.x = -ship.pos[0] * cameraRef.current.zoom;
        cameraRef.current.y = -ship.pos[1] * cameraRef.current.zoom;
        followRef.current = true;
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [sim, selectedShipId]);

  useEffect(() => {
    // Keep sound and visual effects on the same combat events.
    sim.onBeamFire = (from, to, color, width) => {
      effectsRef.current.addBeam(from, to, color, width, 0.16);
      spaceAudio.playWeapon("beam_laser");
    };
    sim.onFlakBurst = (pos, radius) => {
      effectsRef.current.addFlakBurst(pos, radius);
      spaceAudio.playWeapon("point_defense");
    };
    sim.onProjectileFire = (type) => spaceAudio.playWeapon(type);
    sim.onShieldHit = (_pos, intensity) => spaceAudio.playShieldHit(intensity);
    sim.onShipDestroyed = (ship) => {
      effectsRef.current.addShipExplosion(ship);
      spaceAudio.playExplosion(ship);
    };
    sim.onVictory = (winnerTeam) => spaceAudio.playVictory(winnerTeam);

    let animId: number;
    let lastTime = performance.now();

    const renderLoop = (now: number) => {
      const rawDt = (now - lastTime) / 1000;
      lastTime = now;
      const dt = rawDt;

      if (speed > 0) {
        sim.update(dt * speed);
        effectsRef.current.update(dt * speed, sim.ships);
      }

      const targetShip =
        followRef.current && sim.ships.find((s) => s.id === selectedShipId && s.isAlive);
      if (targetShip) {
        const camera = cameraRef.current;
        camera.x += (-targetShip.pos[0] * camera.zoom - camera.x) * 0.08;
        camera.y += (-targetShip.pos[1] * camera.zoom - camera.y) * 0.08;
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

          // Draw expanding ship explosion cores and shockwaves.
          for (const core of effectsRef.current.shipExplosionCores) {
            if (core.delay > 0) continue;
            const progress = 1 - core.remainingDuration / core.maxDuration;
            const radius = core.maxRadius * (0.15 + 0.85 * progress);
            const gradient = ctx.createRadialGradient(
              core.pos[0],
              core.pos[1],
              0,
              core.pos[0],
              core.pos[1],
              radius,
            );
            const alpha = 1 - progress;
            gradient.addColorStop(0, `rgba(255, 245, 180, ${alpha})`);
            gradient.addColorStop(0.35, `rgba(251, 146, 60, ${alpha * 0.85})`);
            gradient.addColorStop(1, "rgba(154, 52, 18, 0)");
            ctx.fillStyle = gradient;
            ctx.beginPath();
            ctx.arc(core.pos[0], core.pos[1], radius, 0, Math.PI * 2);
            ctx.fill();
          }

          for (const wave of effectsRef.current.shipShockwaves) {
            const alpha = wave.remainingDuration / wave.maxDuration;
            const radius = wave.maxRadius * (1 - alpha);
            ctx.strokeStyle = `rgba(255, 160, 55, ${alpha * 0.9})`;
            ctx.lineWidth = Math.max(1, wave.maxRadius * 0.025 * alpha);
            ctx.beginPath();
            ctx.arc(wave.pos[0], wave.pos[1], radius, 0, Math.PI * 2);
            ctx.stroke();
          }

          // Draw Particles
          ctx.save();
          for (const p of effectsRef.current.particles) {
            ctx.globalAlpha = p.remainingDuration / p.maxDuration;
            ctx.fillStyle = p.color;
            ctx.beginPath();
            ctx.arc(p.pos[0], p.pos[1], p.radius, 0, Math.PI * 2);
            ctx.fill();
          }
          ctx.restore();

          for (const shard of effectsRef.current.debrisShards) {
            ctx.save();
            ctx.translate(shard.pos[0], shard.pos[1]);
            ctx.rotate(shard.angle);
            ctx.globalAlpha = shard.remainingDuration / shard.maxDuration;
            ctx.fillStyle = shard.color;
            ctx.strokeStyle = shard.accentColor;
            ctx.lineWidth = Math.max(0.5, shard.size * 0.12);
            ctx.beginPath();
            ctx.moveTo(shard.points[0][0] * shard.size, shard.points[0][1] * shard.size);
            for (const [x, y] of shard.points.slice(1)) ctx.lineTo(x * shard.size, y * shard.size);
            ctx.closePath();
            ctx.fill();
            ctx.stroke();
            ctx.restore();
          }

          ctx.save();
          for (const p of effectsRef.current.engineParticles) {
            ctx.globalAlpha = p.remainingDuration / p.maxDuration;
            ctx.fillStyle = p.color;
            ctx.beginPath();
            ctx.arc(p.pos[0], p.pos[1], p.radius, 0, Math.PI * 2);
            ctx.fill();
          }
          ctx.restore();

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
      if (dx !== 0 || dy !== 0) followRef.current = false;
      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
        hasDraggedRef.current = true;
      }
      cameraRef.current.x += dx;
      cameraRef.current.y += dy;
      dragStartRef.current = { x: e.clientX, y: e.clientY };
    }
  };

  const shipAtPoint = (e: React.MouseEvent): string | null => {
    if (canvasRef.current) {
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

      return clickedShip;
    }
    return null;
  };

  const handleMouseUp = (e: React.MouseEvent) => {
    if (!isDraggingRef.current) return;
    isDraggingRef.current = false;

    // Click selection (if not a pan drag)
    if (!hasDraggedRef.current && onSelectShip) {
      const clickedShip = shipAtPoint(e);
      followRef.current = Boolean(clickedShip);
      onSelectShip(clickedShip);
    }
  };

  const handleDoubleClick = (e: React.MouseEvent) => {
    if (!shipAtPoint(e)) {
      followRef.current = false;
      cameraRef.current.x = 0;
      cameraRef.current.y = 0;
    }
  };

  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const x = ((e.clientX - rect.left) * canvas.width) / rect.width - canvas.width / 2;
    const y = ((e.clientY - rect.top) * canvas.height) / rect.height - canvas.height / 2;
    const camera = cameraRef.current;
    const zoomFactor = e.deltaY < 0 ? 1.1 : 0.9;
    const zoom = Math.max(0.3, Math.min(2.5, camera.zoom * zoomFactor));
    const ratio = zoom / camera.zoom;
    camera.x = x - (x - camera.x) * ratio;
    camera.y = y - (y - camera.y) * ratio;
    camera.zoom = zoom;
  };

  return (
    <div className="relative w-full h-full overflow-hidden select-none cursor-grab active:cursor-grabbing">
      <canvas
        ref={canvasRef}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={() => {
          isDraggingRef.current = false;
        }}
        onDoubleClick={handleDoubleClick}
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

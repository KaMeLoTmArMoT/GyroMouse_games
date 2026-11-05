// React 2.5D Tactical Canvas Component with click/hover ship selection, pan/zoom, and live range cones

import { useEffect, useRef } from "react";
import { spaceAudio } from "../engine/audioEngine";
import { ARENA_HARD_PULL_RADIUS, ARENA_RADIUS } from "../engine/flightControl";
import {
  type ClientCombatSimulation,
  type FighterWingVisual,
  WING_WAVE_DELAY,
} from "../engine/simulation";
import type { ShipState } from "../types/combat";
import { VisualEffectsManager } from "./effects";
import {
  renderBeam,
  renderProjectile,
  renderProjectileGuidance,
  renderProjectileThreats,
} from "./projectileRenderer";
import { projectileAtPoint } from "./projectileSelection";
import { renderShip } from "./shipRenderer";

interface TacticalCanvasProps {
  sim: ClientCombatSimulation;
  speed: number;
  ingressRevision: number;
  selectedShipId?: string | null;
  onSelectShip?: (shipId: string | null) => void;
  selectedProjectileId?: string | null;
  onSelectProjectile?: (projectileId: string | null) => void;
}

export function TacticalCanvas({
  sim,
  speed,
  ingressRevision,
  selectedShipId,
  onSelectShip,
  selectedProjectileId,
  onSelectProjectile,
}: TacticalCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const effectsRef = useRef<VisualEffectsManager>(new VisualEffectsManager());
  const pendingIngressRef = useRef(false);

  const cameraRef = useRef<{ x: number; y: number; zoom: number }>({ x: 0, y: 0, zoom: 0.85 });
  const isDraggingRef = useRef(false);
  const dragStartRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const hasDraggedRef = useRef(false);
  const followRef = useRef(Boolean(selectedShipId));

  useEffect(() => {
    followRef.current = Boolean(selectedShipId);
  }, [selectedShipId]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: A continued battle reuses the same simulation.
  useEffect(() => {
    effectsRef.current = new VisualEffectsManager();
    pendingIngressRef.current = sim.timeElapsed === 0;
  }, [sim, ingressRevision]);

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
    sim.onBeamFire = (from, to, color, width, ownerTeam, channeled) => {
      if (!channeled) effectsRef.current.addBeam(from, to, color, width, ownerTeam, 0.16);
      spaceAudio.playWeapon("beam_laser");
    };
    sim.onFlakBurst = (pos, radius, ownerTeam) => {
      effectsRef.current.addFlakBurst(pos, radius, ownerTeam);
      spaceAudio.playWeapon("point_defense");
    };
    sim.onProjectileFire = (type) => spaceAudio.playWeapon(type);
    sim.onShieldHit = (_pos, intensity) => spaceAudio.playShieldHit(intensity);
    sim.onWeaponImpact = (ship, origin, shield, armor, hull) => {
      const angle = Math.atan2(origin[1] - ship.pos[1], origin[0] - ship.pos[0]);
      if (shield) effectsRef.current.addShieldImpact(ship.id, ship.pos, ship.size, angle);
      if (armor || hull) {
        const pos: [number, number] = [
          ship.pos[0] + Math.cos(angle) * ship.size * 0.5,
          ship.pos[1] + Math.sin(angle) * ship.size * 0.5,
        ];
        effectsRef.current.addDamageDecal(ship, angle);
        if (armor) effectsRef.current.addImpactSparks(pos, angle);
        if (hull) effectsRef.current.addHullImpact(pos, angle);
      }
    };
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
        if (pendingIngressRef.current) {
          effectsRef.current.triggerFleetWarpIn(sim.ships);
          pendingIngressRef.current = false;
          const canvas = canvasRef.current;
          const camera = cameraRef.current;
          const alive = sim.ships.filter((ship) => ship.isAlive);
          if (canvas && alive.length > 0) {
            const minX = Math.min(...alive.map((ship) => ship.pos[0] - ship.size * 2));
            const maxX = Math.max(...alive.map((ship) => ship.pos[0] + ship.size * 2));
            const minY = Math.min(...alive.map((ship) => ship.pos[1] - ship.size * 2));
            const maxY = Math.max(...alive.map((ship) => ship.pos[1] + ship.size * 2));
            camera.zoom = Math.max(
              0.3,
              Math.min(0.85, canvas.width / (maxX - minX), canvas.height / (maxY - minY)),
            );
            camera.x = -((minX + maxX) / 2) * camera.zoom;
            camera.y = -((minY + maxY) / 2) * camera.zoom;
            followRef.current = false;
          }
        }
        sim.update(dt * speed);
        effectsRef.current.update(dt * speed, sim.ships, sim.projectiles);
        effectsRef.current.updateWarpGates(Math.min(dt, 0.05));
        effectsRef.current.syncBeams(sim.activeBeams);
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

          const wings = sim.getFighterWingVisuals();
          drawEchelonIndicators(ctx, wings, sim.ships);

          effectsRef.current.render(ctx);

          // Draw Active Beams
          for (const beam of effectsRef.current.beams) {
            renderBeam(ctx, beam, sim.timeElapsed);
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

          ctx.save();
          for (const p of effectsRef.current.smokeParticles) {
            ctx.globalAlpha = (p.remainingDuration / p.maxDuration) * 0.7;
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

            ctx.strokeStyle =
              burst.ownerTeam === 0
                ? `rgba(251, 146, 60, ${0.85 * alpha})`
                : `rgba(239, 68, 68, ${0.85 * alpha})`;
            ctx.lineWidth = 3;
            ctx.beginPath();
            ctx.arc(burst.pos[0], burst.pos[1], burst.radius, 0, Math.PI * 2);
            ctx.stroke();

            ctx.strokeStyle =
              burst.ownerTeam === 0
                ? `rgba(250, 204, 21, ${0.5 * alpha})`
                : `rgba(244, 114, 182, ${0.5 * alpha})`;
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
          const ingressGates = new Map(
            effectsRef.current.warpGates.map((gate) => [gate.shipId, gate]),
          );
          for (const ship of sim.ships) {
            const gate = ingressGates.get(ship.id);
            ctx.save();
            if (gate) {
              const progress = Math.min(1, (gate.maxDuration - gate.remainingDuration) / 0.5);
              const eased = progress * progress * (3 - 2 * progress);
              const offset = (1 - eased) * ship.size;
              ctx.translate(-Math.cos(gate.heading) * offset, -Math.sin(gate.heading) * offset);
              ctx.globalAlpha = eased;
            }
            renderShip(
              ctx,
              ship,
              ship.id === selectedShipId,
              effectsRef.current.impactDecals.get(ship),
              sim.timeElapsed,
            );
            ctx.restore();
          }

          // Draw Selected Ship Billiards Trajectory & Tactical Intent HUD
          if (selectedShipId) {
            const selectedShip = sim.ships.find((s) => s.id === selectedShipId && s.isAlive);
            if (selectedShip) {
              drawTacticalTrajectory(ctx, selectedShip, sim, wings);
            }
          }

          const selectedProjectile = sim.projectiles.find((p) => p.id === selectedProjectileId);
          if (selectedProjectile) {
            const target = sim.ships.find((s) => s.id === selectedProjectile.targetId && s.isAlive);
            renderProjectileGuidance(ctx, selectedProjectile, target, cameraRef.current.zoom);
            renderProjectileThreats(ctx, selectedProjectile, sim.ships, cameraRef.current.zoom);
          }

          ctx.save();
          for (const impact of effectsRef.current.shieldImpacts) {
            const ship = sim.ships.find((s) => s.id === impact.shipId && s.isAlive);
            const [x, y] = ship?.pos ?? impact.pos;
            const radius = impact.shipRadius * 1.4;
            const alpha = impact.remainingDuration / 0.35;
            const progress = 1 - alpha;
            const px = x + Math.cos(impact.impactAngle) * radius;
            const py = y + Math.sin(impact.impactAngle) * radius;
            ctx.globalAlpha = alpha;
            ctx.shadowColor = "#38bdf8";
            ctx.shadowBlur = 12;
            ctx.strokeStyle = "#67e8f9";
            ctx.lineWidth = 3;
            ctx.beginPath();
            ctx.arc(x, y, radius, impact.impactAngle - 0.42, impact.impactAngle + 0.42);
            ctx.stroke();
            ctx.strokeStyle = "#38bdf8";
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.arc(px, py, 3 + progress * Math.max(18, radius * 0.5), 0, Math.PI * 2);
            ctx.stroke();
            const glowRadius = Math.max(4, radius * 0.2);
            const glow = ctx.createRadialGradient(px, py, 0, px, py, glowRadius);
            glow.addColorStop(0, "#ffffff");
            glow.addColorStop(0.35, "#a5f3fc");
            glow.addColorStop(1, "rgba(56, 189, 248, 0)");
            ctx.fillStyle = glow;
            ctx.beginPath();
            ctx.arc(px, py, glowRadius, 0, Math.PI * 2);
            ctx.fill();
          }
          ctx.restore();

          ctx.save();
          for (const p of effectsRef.current.sparkParticles) {
            ctx.globalAlpha = p.remainingDuration / p.maxDuration;
            ctx.strokeStyle = p.color;
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.moveTo(p.pos[0], p.pos[1]);
            ctx.lineTo(p.pos[0] - p.velocity[0] * 0.035, p.pos[1] - p.velocity[1] * 0.035);
            ctx.lineTo(
              p.pos[0] - p.velocity[0] * 0.055 - p.velocity[1] * 0.01,
              p.pos[1] - p.velocity[1] * 0.055 + p.velocity[0] * 0.01,
            );
            ctx.stroke();
          }
          ctx.restore();

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
      sim.onWeaponImpact = undefined;
      sim.onShipDestroyed = undefined;
      sim.onVictory = undefined;
    };
  }, [sim, speed, selectedShipId, selectedProjectileId]);

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
      const clickX = ((e.clientX - rect.left) * canvasRef.current.width) / rect.width;
      const clickY = ((e.clientY - rect.top) * canvasRef.current.height) / rect.height;

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

  const projectileAtMouse = (e: React.MouseEvent, shipClicked: boolean): string | null => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const camera = cameraRef.current;
    const x = ((e.clientX - rect.left) * canvas.width) / rect.width;
    const y = ((e.clientY - rect.top) * canvas.height) / rect.height;
    return projectileAtPoint(
      sim.projectiles,
      (x - canvas.width / 2 - camera.x) / camera.zoom,
      (y - canvas.height / 2 - camera.y) / camera.zoom,
      (camera.zoom * rect.width) / canvas.width,
      (camera.zoom * rect.height) / canvas.height,
      shipClicked,
    );
  };

  const handleMouseUp = (e: React.MouseEvent) => {
    if (!isDraggingRef.current) return;
    isDraggingRef.current = false;

    // Click selection (if not a pan drag)
    if (!hasDraggedRef.current) {
      const clickedShip = shipAtPoint(e);
      const projectile = projectileAtMouse(e, Boolean(clickedShip));
      if (projectile) {
        followRef.current = false;
        onSelectProjectile?.(projectile);
        return;
      }
      followRef.current = Boolean(clickedShip);
      onSelectShip?.(clickedShip);
    }
  };

  const handleDoubleClick = (e: React.MouseEvent) => {
    if (!shipAtPoint(e) && !projectileAtMouse(e, false)) {
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
          Click ship or torpedo to inspect | Drag to Pan
        </div>
      </div>
    </div>
  );
}

function echelonLabel(wing: FighterWingVisual): string {
  const timing =
    wing.wave === 1 ? "Lead" : `Wave +${((wing.wave - 1) * WING_WAVE_DELAY).toFixed(1)}s`;
  return `Echelon ${wing.wave} (${timing})`;
}

function drawEchelonIndicators(
  ctx: CanvasRenderingContext2D,
  wings: FighterWingVisual[],
  ships: ShipState[],
): void {
  for (const wing of wings) {
    const members = ships.filter((ship) => ship.isAlive && wing.members.includes(ship.id));
    if (members.length === 0) continue;
    const x = members.reduce((sum, ship) => sum + ship.pos[0], 0) / members.length;
    const y = members.reduce((sum, ship) => sum + ship.pos[1], 0) / members.length;
    const heading =
      wing.heading + (wing.phase === "egress" || wing.phase === "rejoin" ? Math.PI : 0);
    const color =
      wing.phase === "attack" ? "#fbbf24" : wing.phase === "egress" ? "#a5f3fc" : "#94a3b8";
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(heading);
    ctx.globalAlpha = 0.65;
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (const offset of [35, 45]) {
      ctx.moveTo(offset - 7, -8);
      ctx.lineTo(offset, 0);
      ctx.lineTo(offset - 7, 8);
    }
    ctx.stroke();
    ctx.restore();
    ctx.save();
    ctx.fillStyle = color;
    ctx.globalAlpha = 0.8;
    ctx.font = "10px monospace";
    ctx.textAlign = "center";
    ctx.fillText(
      `${wing.team === 0 ? "BLUE" : "RED"} G${wing.groupId} E${wing.wave} ${wing.phase.toUpperCase()}`,
      x,
      y - 25,
    );
    ctx.restore();
  }
}

function drawTacticalGrid(ctx: CanvasRenderingContext2D): void {
  const gridSize = 100;
  const radius = ARENA_HARD_PULL_RADIUS;

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

  // Arena soft boundary ring
  ctx.strokeStyle = "rgba(56, 189, 248, 0.2)";
  ctx.lineWidth = 1.5;
  ctx.setLineDash([8, 8]);
  ctx.beginPath();
  ctx.arc(0, 0, ARENA_RADIUS, 0, Math.PI * 2);
  ctx.stroke();

  // Arena hard pull perimeter
  ctx.strokeStyle = "rgba(239, 68, 68, 0.25)";
  ctx.lineWidth = 2;
  ctx.setLineDash([4, 4]);
  ctx.beginPath();
  ctx.arc(0, 0, ARENA_HARD_PULL_RADIUS, 0, Math.PI * 2);
  ctx.stroke();
  ctx.setLineDash([]);
}

function drawTacticalTrajectory(
  ctx: CanvasRenderingContext2D,
  ship: ShipState,
  sim: ClientCombatSimulation,
  wings: FighterWingVisual[],
): void {
  const isBlue = ship.team === 0;
  const primaryColor = isBlue ? "#38bdf8" : "#f87171";
  const speed = Math.hypot(ship.velocity[0], ship.velocity[1]);

  // 1. Target Lock & Engagement Line
  const targetId =
    ship.maneuverTargetId ??
    ship.dogfightTargetId ??
    ship.turrets.find((t) => t.currentTargetId)?.currentTargetId ??
    null;
  const target = targetId
    ? sim.ships.find((s) => s.id === targetId && s.isAlive && s.team !== ship.team)
    : null;

  if (target) {
    const dist = Math.hypot(target.pos[0] - ship.pos[0], target.pos[1] - ship.pos[1]);
    ctx.save();
    ctx.strokeStyle = "rgba(239, 68, 68, 0.4)";
    ctx.lineWidth = 1.2;
    ctx.setLineDash([4, 6]);
    ctx.beginPath();
    ctx.moveTo(ship.pos[0], ship.pos[1]);
    ctx.lineTo(target.pos[0], target.pos[1]);
    ctx.stroke();

    // Target Corner Brackets
    const br = Math.max(target.size * 1.4, 20);
    const bLen = Math.min(br * 0.4, 10);
    ctx.strokeStyle = "#ef4444";
    ctx.lineWidth = 1.5;
    ctx.setLineDash([]);
    const [tx, ty] = target.pos;

    ctx.beginPath();
    // Top-left
    ctx.moveTo(tx - br, ty - br + bLen);
    ctx.lineTo(tx - br, ty - br);
    ctx.lineTo(tx - br + bLen, ty - br);
    // Top-right
    ctx.moveTo(tx + br - bLen, ty - br);
    ctx.lineTo(tx + br, ty - br);
    ctx.lineTo(tx + br, ty - br + bLen);
    // Bottom-left
    ctx.moveTo(tx - br, ty + br - bLen);
    ctx.lineTo(tx - br, ty + br);
    ctx.lineTo(tx - br + bLen, ty + br);
    // Bottom-right
    ctx.moveTo(tx + br - bLen, ty + br);
    ctx.lineTo(tx + br, ty + br);
    ctx.lineTo(tx + br, ty + br - bLen);
    ctx.stroke();

    // Target Label
    ctx.fillStyle = "rgba(239, 68, 68, 0.9)";
    ctx.font = "10px monospace";
    ctx.textAlign = "center";
    ctx.fillText(`LOCK: ${target.name} (${Math.round(dist)}u)`, tx, ty - br - 5);
    ctx.restore();
  }

  // 2. Extrapolated Billiards-Style Trajectory Course Vector
  if (speed > 3) {
    const horizon = 2.5; // Look ahead 2.5 seconds
    const predX = ship.pos[0] + ship.velocity[0] * horizon;
    const predY = ship.pos[1] + ship.velocity[1] * horizon;

    ctx.save();
    ctx.strokeStyle = primaryColor;
    ctx.lineWidth = 1.8;
    ctx.setLineDash([6, 6]);
    ctx.shadowColor = primaryColor;
    ctx.shadowBlur = 6;

    ctx.beginPath();
    ctx.moveTo(ship.pos[0], ship.pos[1]);
    ctx.lineTo(predX, predY);
    ctx.stroke();

    // End Waypoint Marker (Circle + Reticle)
    ctx.shadowBlur = 0;
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.arc(predX, predY, 8, 0, Math.PI * 2);
    ctx.stroke();

    ctx.fillStyle = primaryColor;
    ctx.beginPath();
    ctx.arc(predX, predY, 3, 0, Math.PI * 2);
    ctx.fill();

    // Crosshair ticks
    ctx.beginPath();
    ctx.moveTo(predX - 12, predY);
    ctx.lineTo(predX - 8, predY);
    ctx.moveTo(predX + 8, predY);
    ctx.lineTo(predX + 12, predY);
    ctx.moveTo(predX, predY - 12);
    ctx.lineTo(predX, predY - 8);
    ctx.moveTo(predX, predY + 8);
    ctx.lineTo(predX, predY + 12);
    ctx.stroke();

    // Time tag
    ctx.font = "9px monospace";
    ctx.textAlign = "left";
    ctx.fillStyle = primaryColor;
    ctx.fillText(`+${horizon}s`, predX + 14, predY + 3);
    ctx.restore();
  }

  // 3. Tactical Intent & State HUD Pill
  let intent = "COMBAT PATROL";
  if (ship.hullClass === "strike_craft") {
    switch (ship.fighterPhase) {
      case "attack":
        intent = "STRIKE RUN";
        break;
      case "egress":
        intent = "EGRESS / REPOSITION";
        break;
      case "staging":
        intent = "STAGING FORMATION";
        break;
      case "rejoin":
        intent = "REJOINING SQUAD";
        break;
      case "recover":
        intent = "RECOVERING / RETREAT";
        break;
      default:
        intent = ship.dogfightTargetId ? "DOGFIGHT INTERCEPT" : "WING CRUISE";
    }
  } else if (ship.hullClass === "battleship" || ship.hullClass === "cruiser") {
    if (ship.escapeUntil && ship.escapeUntil > sim.timeElapsed) {
      intent = "EVADING SPINAL FIRE";
    } else if (ship.capitalManeuver === "broadside_hold") {
      intent = "BROADSIDE COMBAT";
    } else if (ship.capitalManeuver === "bow_acquire") {
      intent = "BOW PURSUIT";
    } else if (target) {
      intent = "ENGAGING CAPITAL";
    } else {
      intent = "LINE OF BATTLE";
    }
  } else if (ship.hullClass === "corvette") {
    intent = target ? "SCREEN & FLAK FIRE" : "ESCORT FORMATION";
  }

  // Render Intent Tag below ship
  const pillY = ship.pos[1] + ship.size + 18;
  const pillX = ship.pos[0];
  const line1 = `SPD: ${Math.round(speed)} u/s • ${intent}`;
  const line2 = target
    ? `TGT: ${target.name} [${Math.round(Math.hypot(target.pos[0] - ship.pos[0], target.pos[1] - ship.pos[1]))}u]`
    : null;
  const relatedWings = wings.filter((wing) => {
    if (!wing.members.some((id) => sim.ships.some((member) => member.id === id && member.isAlive)))
      return false;
    if (ship.hullClass === "strike_craft") return wing.members.includes(ship.id);
    if (ship.hullClass === "cruiser" || ship.hullClass === "battleship") {
      return wing.team === ship.team || wing.targetId === ship.id;
    }
    return false;
  });
  const wingLines = relatedWings.map((wing) => {
    const affiliation =
      ship.hullClass === "strike_craft"
        ? ""
        : `${wing.team === ship.team ? "FRIENDLY" : "INCOMING"} G${wing.groupId} • `;
    return `${affiliation}${echelonLabel(wing)} • ${wing.phase.toUpperCase()}`;
  });
  if (ship.hullClass === "strike_craft" && wingLines.length === 0)
    wingLines.push("ECHELON PENDING");

  ctx.save();
  ctx.font = "10px monospace";
  const w1 = ctx.measureText(line1).width;
  const w2 = line2 ? ctx.measureText(line2).width : 0;
  const boxW = Math.max(w1, w2, ...wingLines.map((line) => ctx.measureText(line).width)) + 16;
  const boxH = 18 + (line2 ? 13 : 0) + wingLines.length * 13;

  ctx.fillStyle = "rgba(10, 15, 26, 0.85)";
  ctx.strokeStyle = primaryColor;
  ctx.lineWidth = 1;

  ctx.beginPath();
  if (ctx.roundRect) {
    ctx.roundRect(pillX - boxW / 2, pillY - 4, boxW, boxH, 4);
  } else {
    ctx.rect(pillX - boxW / 2, pillY - 4, boxW, boxH);
  }
  ctx.fill();
  ctx.stroke();

  ctx.textAlign = "center";
  ctx.fillStyle = primaryColor;
  ctx.fillText(line1, pillX, pillY + 9);
  if (line2) {
    ctx.fillStyle = "rgba(244, 114, 182, 0.9)";
    ctx.fillText(line2, pillX, pillY + 22);
  }
  ctx.fillStyle = "#fbbf24";
  wingLines.forEach((line, index) => {
    ctx.fillText(line, pillX, pillY + 22 + (line2 ? 13 : 0) + index * 13);
  });
  ctx.restore();
}

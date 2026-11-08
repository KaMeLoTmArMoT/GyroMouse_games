// React 2.5D Tactical Canvas Component with click/hover ship selection, pan/zoom, and live range cones

import { useEffect, useMemo, useRef, useState } from "react";
import type { PerformanceSamples } from "../components/PerformanceHud";
import { spaceAudio } from "../engine/audioEngine";
import { ARENA_HARD_PULL_RADIUS, ARENA_RADIUS } from "../engine/flightControl";
import { HARMONIC_RANGE } from "../engine/harmonicShieldSystem";
import { shieldEnvelopeRadius } from "../engine/shieldGeometry";
import {
  type ClientCombatSimulation,
  type FighterWingVisual,
  WING_WAVE_DELAY,
} from "../engine/simulation";
import type { SimulationWorkerClient } from "../engine/simulationWorkerClient";
import type { ShipState } from "../types/combat";
import { VisualEffectsManager } from "./effects";
import { drawGlowLine } from "./glowSprites";
import { renderHavenSlots, renderHavenTethers } from "./havenRenderer";
import { renderMapObstacles } from "./obstacleRenderer";
import {
  renderBeam,
  renderProjectile,
  renderProjectileGuidance,
  renderProjectileThreats,
} from "./projectileRenderer";
import { projectileAtPoint } from "./projectileSelection";
import { renderShip } from "./shipRenderer";
import { SimulationPresenter, type TacticalPresentationState } from "./simulationPresenter";
import { discVisible, segmentVisible, type Viewport, worldViewport } from "./viewport";
import { dispatchWorkerPresentationEvents } from "./workerPresentationEvents";

interface TacticalCanvasProps {
  sim: ClientCombatSimulation;
  // Optional caller-owned transport. With a client, sim supplies only map/crew
  // setup; rendering, hit-testing and effects use an independent presentation.
  // Route tactical commands through client.command and dispose on battle reset.
  workerClient?: SimulationWorkerClient;
  workerPresenter?: SimulationPresenter;
  speed: number;
  ingressRevision: number;
  selectedShipId?: string | null;
  onSelectShip?: (shipId: string | null) => void;
  selectedProjectileId?: string | null;
  onSelectProjectile?: (projectileId: string | null) => void;
  performanceSamples?: PerformanceSamples;
}

type TacticalCamera = { x: number; y: number; zoom: number; pitchDeg: number };
const RENDER_INTERVAL_MS = 1000 / 60;

export function clampCameraPitch(deg: number): number {
  return Math.max(25, Math.min(90, deg));
}

export function pitchVerticalScale(pitchDeg: number): number {
  return Math.sin((clampCameraPitch(pitchDeg) * Math.PI) / 180);
}

/** Screen coordinates are canvas pixels; camera offsets are unprojected pixels. */
export function screenToWorldPoint(
  x: number,
  y: number,
  width: number,
  height: number,
  camera: TacticalCamera,
): [number, number] {
  const verticalScale = pitchVerticalScale(camera.pitchDeg);
  return [
    (x - width / 2 - camera.x) / camera.zoom,
    ((y - height / 2) / verticalScale - camera.y) / camera.zoom,
  ];
}

export function TacticalCanvas({
  sim,
  workerClient,
  workerPresenter,
  speed,
  ingressRevision,
  selectedShipId,
  onSelectShip,
  selectedProjectileId,
  onSelectProjectile,
  performanceSamples,
}: TacticalCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const effectsRef = useRef<VisualEffectsManager>(new VisualEffectsManager());
  const pendingIngressRef = useRef(false);
  const presenter = useMemo(
    () => workerPresenter ?? new SimulationPresenter(sim, workerClient),
    [sim, workerClient, workerPresenter],
  );
  const presentation = presenter.state;

  useEffect(() => {
    performanceSamples?.resetSimulationClock();
  }, [performanceSamples]);

  useEffect(() => () => presenter.frame(performance.now(), 0, 0), [presenter]);

  const cameraRef = useRef<TacticalCamera>({ x: 0, y: 0, zoom: 0.85, pitchDeg: 90 });
  const [pitchDeg, setPitchDeg] = useState(90);
  const dragModeRef = useRef<"pan" | "tilt" | null>(null);
  const dragStartRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const dragOriginRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const hasDraggedRef = useRef(false);
  const followRef = useRef(false);

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
      const ship = presentation.ships.find((s) => s.id === selectedShipId && s.isAlive);
      if (ship) {
        cameraRef.current.x = -ship.pos[0] * cameraRef.current.zoom;
        cameraRef.current.y = -ship.pos[1] * cameraRef.current.zoom;
        followRef.current = true;
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [presentation, selectedShipId]);

  useEffect(() => {
    // Keep sound and visual effects on the same combat events.
    const directSimulation = sim;
    sim.onBeamFire = (from, to, color, width, ownerTeam, channeled) => {
      if (!channeled) effectsRef.current.addBeam(from, to, color, width, ownerTeam, 0.16);
      spaceAudio.playWeapon("beam_laser");
    };
    sim.onFlakBurst = (pos, radius, ownerTeam) => {
      effectsRef.current.addFlakBurst(pos, radius, ownerTeam);
    };
    sim.onProjectileFire = (type) => {
      if (type !== "missile") spaceAudio.playWeapon(type);
    };
    sim.onAudioEvent = (event) => {
      // Fleet ingress is queued before the canvas mounts and plays with its visual effect.
      if (event.type !== "warp_ingress") spaceAudio.playCombatEvent(event.type);
    };
    sim.onShieldHit = (_pos, intensity) => spaceAudio.playShieldHit(intensity);
    sim.onWeaponImpact = (ship, origin, shield, armor, hull) => {
      const angle = Math.atan2(origin[1] - ship.pos[1], origin[0] - ship.pos[0]);
      if (shield)
        effectsRef.current.addShieldImpact(ship.id, ship.pos, shieldEnvelopeRadius(ship), angle);
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
    let lastTime: number | null = null;
    let nextRenderTime: number | null = null;
    let focused = document.hasFocus();
    const handleBlur = () => {
      focused = false;
      presenter.frame(performance.now(), 0, 0);
    };
    const handleFocus = () => {
      focused = true;
      lastTime = null;
      nextRenderTime = null;
      performanceSamples?.resetSimulationClock();
    };
    const handleVisibilityChange = () => {
      lastTime = null;
      nextRenderTime = null;
      performanceSamples?.resetSimulationClock();
      if (document.hidden) presenter.frame(performance.now(), 0, 0);
    };
    window.addEventListener("blur", handleBlur);
    window.addEventListener("focus", handleFocus);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    const renderLoop = (now: number) => {
      // Keep the target cadence across refresh intervals (e.g. 144 Hz) without
      // accumulating drift; sample real elapsed time only when drawing.
      if (nextRenderTime !== null && now + 0.2 < nextRenderTime) {
        animId = requestAnimationFrame(renderLoop);
        return;
      }
      nextRenderTime =
        nextRenderTime === null || now - nextRenderTime >= RENDER_INTERVAL_MS
          ? now + RENDER_INTERVAL_MS
          : nextRenderTime + RENDER_INTERVAL_MS;
      const renderStart = performance.now();
      const rawDt = lastTime === null ? 0 : (now - lastTime) / 1000;
      lastTime = now;
      const dt = Math.max(0, Math.min(rawDt, 0.033));
      if (performanceSamples && focused && !document.hidden && rawDt > 0) {
        performanceSamples.addFrame(rawDt * 1000);
      }

      const previousProjectiles = presenter.state.projectiles.slice();
      const previousTime = presenter.state.timeElapsed;
      const activeSpeed = focused && !document.hidden ? speed : 0;
      if (workerClient) {
        presenter.frame(now, Math.max(0, rawDt), activeSpeed, performanceSamples, (events) =>
          dispatchWorkerPresentationEvents(
            events,
            (id) => presenter.shipById(id),
            effectsRef.current,
            spaceAudio,
          ),
        );
      }
      const sim = presenter.state;

      if (speed > 0 && focused && !document.hidden) {
        if (pendingIngressRef.current && sim.ships.length > 0) {
          if (!workerClient) {
            effectsRef.current.triggerFleetWarpIn(sim.ships);
            if (
              directSimulation.drainAudioEvents().some((event) => event.type === "warp_ingress")
            ) {
              spaceAudio.playCombatEvent("warp_ingress");
            }
          }
          pendingIngressRef.current = false;
          const canvas = canvasRef.current;
          const camera = cameraRef.current;
          const alive = sim.ships.filter((ship) => ship.isAlive && !ship.isDocked);
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
        if (!workerClient) presenter.frame(now, Math.max(0, rawDt), speed, performanceSamples);
        const simulationDelta = Math.max(0, sim.timeElapsed - previousTime);
        effectsRef.current.update(simulationDelta, sim.ships, sim.projectiles);
        effectsRef.current.captureExpiredProjectiles(previousProjectiles, sim.projectiles);
        effectsRef.current.updateWarpGates(simulationDelta);
        effectsRef.current.syncBeams(sim.activeBeams);
      }

      const measuredTime = workerClient
        ? workerClient.latestSnapshot?.timeElapsed
        : sim.timeElapsed;
      if (measuredTime !== undefined && focused && !document.hidden) {
        performanceSamples?.addSimulationTime(now, measuredTime);
      }

      const targetShip =
        followRef.current && sim.ships.find((s) => s.id === selectedShipId && s.isAlive);
      if (targetShip) {
        const camera = cameraRef.current;
        const followAlpha = 1 - (1 - 0.08) ** (dt * 60);
        camera.x += (-targetShip.pos[0] * camera.zoom - camera.x) * followAlpha;
        camera.y += (-targetShip.pos[1] * camera.zoom - camera.y) * followAlpha;
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
          const camera = cameraRef.current;
          const verticalScale = pitchVerticalScale(camera.pitchDeg);
          ctx.translate(canvas.width / 2 + camera.x, canvas.height / 2 + camera.y * verticalScale);
          ctx.scale(camera.zoom, camera.zoom * verticalScale);
          const viewport = worldViewport(canvas.width, canvas.height / verticalScale, camera);

          drawTacticalGrid(ctx, sim.timeElapsed, camera.pitchDeg);
          renderMapObstacles(ctx, sim.mapObstacles, viewport, (camera.pitchDeg * Math.PI) / 180);

          const selectedTender = sim.ships.find(
            (ship) =>
              ship.id === selectedShipId &&
              ship.isAlive &&
              !ship.isDebris &&
              ship.hullClass === "tender",
          );
          if (selectedTender) {
            ctx.save();
            ctx.strokeStyle = selectedTender.team === 0 ? "#22d3ee" : "#f43f5e";
            ctx.globalAlpha = 0.2;
            ctx.lineWidth = 1.5;
            ctx.setLineDash([8, 8]);
            ctx.beginPath();
            ctx.arc(...selectedTender.pos, HARMONIC_RANGE, 0, Math.PI * 2);
            ctx.stroke();
            ctx.restore();
          }

          const wings = sim.getFighterWingVisuals();
          drawEchelonIndicators(ctx, wings, sim.ships);

          effectsRef.current.render(ctx);

          // Draw Active Beams
          for (const beam of effectsRef.current.beams) {
            if (!segmentVisible(viewport, beam.from, beam.to, beam.width * 4 + 40)) continue;
            renderBeam(ctx, beam, sim.timeElapsed);
          }

          // Draw expanding ship explosion cores and shockwaves.
          for (const core of effectsRef.current.shipExplosionCores) {
            if (core.delay > 0) continue;
            const progress = 1 - core.remainingDuration / core.maxDuration;
            const radius = core.maxRadius * (0.15 + 0.85 * progress);
            if (!discVisible(viewport, core.pos, radius)) continue;
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
            if (!discVisible(viewport, wave.pos, radius + wave.maxRadius * 0.025)) continue;
            ctx.strokeStyle = `rgba(255, 160, 55, ${alpha * 0.9})`;
            ctx.lineWidth = Math.max(1, wave.maxRadius * 0.025 * alpha);
            ctx.beginPath();
            ctx.arc(wave.pos[0], wave.pos[1], radius, 0, Math.PI * 2);
            ctx.stroke();
          }

          // Draw Particles
          ctx.save();
          for (const p of effectsRef.current.particles) {
            if (!discVisible(viewport, p.pos, p.radius)) continue;
            ctx.globalAlpha = p.remainingDuration / p.maxDuration;
            ctx.fillStyle = p.color;
            ctx.beginPath();
            ctx.arc(p.pos[0], p.pos[1], p.radius, 0, Math.PI * 2);
            ctx.fill();
          }
          ctx.restore();

          ctx.save();
          for (const p of effectsRef.current.smokeParticles) {
            if (!discVisible(viewport, p.pos, p.radius)) continue;
            ctx.globalAlpha = (p.remainingDuration / p.maxDuration) * 0.7;
            ctx.fillStyle = p.color;
            ctx.beginPath();
            ctx.arc(p.pos[0], p.pos[1], p.radius, 0, Math.PI * 2);
            ctx.fill();
          }
          ctx.restore();

          for (const shard of effectsRef.current.debrisShards) {
            if (!discVisible(viewport, shard.pos, shard.size * 2)) continue;
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
            if (!discVisible(viewport, p.pos, p.radius)) continue;
            ctx.globalAlpha = p.remainingDuration / p.maxDuration;
            ctx.fillStyle = p.color;
            ctx.beginPath();
            ctx.arc(p.pos[0], p.pos[1], p.radius, 0, Math.PI * 2);
            ctx.fill();
          }
          ctx.restore();

          // Draw Expanding Flak Burst Shockwaves
          for (const burst of effectsRef.current.flakBursts) {
            if (!discVisible(viewport, burst.pos, burst.radius + 3)) continue;
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
            if (!discVisible(viewport, proj.pos, 30)) continue;
            renderProjectile(ctx, proj);
          }
          for (const effect of effectsRef.current.expiredProjectiles) {
            if (!discVisible(viewport, effect.projectile.pos, 30)) continue;
            const alpha = effect.remainingDuration / effect.maxDuration;
            ctx.save();
            ctx.globalAlpha = alpha;
            if (effect.projectile.weaponType !== "missile") {
              const [x, y] = effect.projectile.pos;
              ctx.translate(x, y);
              ctx.scale(alpha, alpha);
              ctx.translate(-x, -y);
            }
            renderProjectile(ctx, effect.projectile, alpha * 0.4);
            ctx.restore();
          }

          // Draw haven conduits beneath ship hulls.
          const visibleShips = sim.ships.filter((ship) => !ship.isDocked);
          renderHavenTethers(ctx, visibleShips, sim.timeElapsed, selectedShipId);

          // Draw Ships
          const ingressGates = new Map(
            effectsRef.current.warpGates.map((gate) => [gate.shipId, gate]),
          );
          const shipsToRender =
            camera.pitchDeg < 89.5
              ? [...visibleShips].sort((a, b) => a.pos[1] - b.pos[1])
              : visibleShips;
          for (const ship of shipsToRender) {
            if (ship.isDocked) continue;
            if (
              ship.id !== selectedShipId &&
              !discVisible(
                viewport,
                ship.pos,
                Math.max(ship.size * 2, shieldEnvelopeRadius(ship) / verticalScale),
              )
            )
              continue;
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
              (camera.pitchDeg * Math.PI) / 180,
            );
            if (ship.isAlive && Math.hypot(...ship.pos) > ARENA_RADIUS) {
              drawRadiationWarning(ctx, ship, sim.timeElapsed);
            }
            ctx.restore();
          }

          // Draw Selected Ship Billiards Trajectory & Tactical Intent HUD
          if (selectedShipId) {
            const selectedShip = sim.ships.find(
              (s) => s.id === selectedShipId && s.isAlive && !s.isDocked,
            );
            if (selectedShip) {
              if (!selectedShip.isDebris) {
                renderHavenSlots(ctx, selectedShip, visibleShips, sim.shieldHaven, sim.timeElapsed);
              }
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
            const radius = ship ? shieldEnvelopeRadius(ship) : impact.shipRadius;
            if (!discVisible(viewport, [x, y], radius * 1.5 + 20)) continue;
            const alpha = impact.remainingDuration / 0.35;
            const progress = 1 - alpha;
            const px = x + Math.cos(impact.impactAngle) * radius;
            const py = y + Math.sin(impact.impactAngle) * radius;
            ctx.globalAlpha = alpha;
            ctx.save();
            ctx.globalAlpha *= 0.35;
            ctx.strokeStyle = "#38bdf8";
            ctx.lineWidth = 3 + 12 / cameraRef.current.zoom;
            ctx.beginPath();
            ctx.arc(x, y, radius, impact.impactAngle - 0.42, impact.impactAngle + 0.42);
            ctx.stroke();
            drawGlowLine(ctx, [px, py], [px, py], "#38bdf8", Math.max(8, radius * 0.3));
            ctx.restore();
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
            const end: [number, number] = [
              p.pos[0] - p.velocity[0] * 0.055 - p.velocity[1] * 0.01,
              p.pos[1] - p.velocity[1] * 0.055 + p.velocity[0] * 0.01,
            ];
            if (!segmentVisible(viewport, p.pos, end, 2)) continue;
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

          const [minX, minY] = screenToWorldPoint(0, 0, canvas.width, canvas.height, camera);
          const [maxX, maxY] = screenToWorldPoint(
            canvas.width,
            canvas.height,
            canvas.width,
            canvas.height,
            camera,
          );
          drawRadiationInterference(ctx, { minX, maxX, minY, maxY }, camera.zoom, sim.timeElapsed);
          ctx.restore();
        }
      }

      performanceSamples?.addRender(performance.now() - renderStart);
      animId = requestAnimationFrame(renderLoop);
    };

    animId = requestAnimationFrame(renderLoop);
    return () => {
      cancelAnimationFrame(animId);
      window.removeEventListener("blur", handleBlur);
      window.removeEventListener("focus", handleFocus);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      sim.onBeamFire = null;
      sim.onFlakBurst = null;
      sim.onProjectileFire = undefined;
      sim.onAudioEvent = undefined;
      sim.onShieldHit = undefined;
      sim.onWeaponImpact = undefined;
      sim.onShipDestroyed = undefined;
      sim.onVictory = undefined;
    };
  }, [
    sim,
    workerClient,
    presenter,
    speed,
    selectedShipId,
    selectedProjectileId,
    performanceSamples,
  ]);

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
    if (e.button === 0 || e.button === 1) {
      if (e.button === 1) e.preventDefault();
      dragModeRef.current = e.button === 1 || e.ctrlKey ? "tilt" : "pan";
      hasDraggedRef.current = false;
      dragStartRef.current = { x: e.clientX, y: e.clientY };
      dragOriginRef.current = { x: e.clientX, y: e.clientY };
    }
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (dragModeRef.current) {
      const dx = e.clientX - dragStartRef.current.x;
      const dy = e.clientY - dragStartRef.current.y;
      if (
        Math.hypot(e.clientX - dragOriginRef.current.x, e.clientY - dragOriginRef.current.y) > 3
      ) {
        hasDraggedRef.current = true;
      }
      const camera = cameraRef.current;
      if (dragModeRef.current === "tilt") {
        camera.pitchDeg = clampCameraPitch(camera.pitchDeg + dy * 0.35);
        setPitchDeg(camera.pitchDeg);
      } else {
        if (dx !== 0 || dy !== 0) followRef.current = false;
        const canvas = canvasRef.current;
        const rect = canvas?.getBoundingClientRect();
        camera.x += dx * (canvas && rect ? canvas.width / rect.width : 1);
        camera.y +=
          (dy * (canvas && rect ? canvas.height / rect.height : 1)) /
          pitchVerticalScale(camera.pitchDeg);
      }
      dragStartRef.current = { x: e.clientX, y: e.clientY };
    }
  };

  const shipAtPoint = (e: React.MouseEvent): string | null => {
    if (canvasRef.current) {
      const rect = canvasRef.current.getBoundingClientRect();
      const clickX = ((e.clientX - rect.left) * canvasRef.current.width) / rect.width;
      const clickY = ((e.clientY - rect.top) * canvasRef.current.height) / rect.height;

      // Convert Screen Coords -> World Coords
      const [worldX, worldY] = screenToWorldPoint(
        clickX,
        clickY,
        canvasRef.current.width,
        canvasRef.current.height,
        cameraRef.current,
      );

      // Find nearest clicked ship
      let clickedShip: string | null = null;
      let minD = 50; // max click radius

      for (const ship of presentation.ships) {
        if (!ship.isAlive || ship.isDocked) continue;
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
    const [worldX, worldY] = screenToWorldPoint(x, y, canvas.width, canvas.height, camera);
    return projectileAtPoint(
      presentation.projectiles,
      worldX,
      worldY,
      (camera.zoom * rect.width) / canvas.width,
      (camera.zoom * pitchVerticalScale(camera.pitchDeg) * rect.height) / canvas.height,
      shipClicked,
    );
  };

  const handleMouseUp = (e: React.MouseEvent) => {
    const mode = dragModeRef.current;
    if (!mode) return;
    dragModeRef.current = null;

    // Click selection (if not a pan drag)
    if (mode === "pan" && !hasDraggedRef.current) {
      const clickedShip = shipAtPoint(e);
      const projectile = projectileAtMouse(e, Boolean(clickedShip));
      if (projectile) {
        followRef.current = false;
        onSelectProjectile?.(projectile);
        return;
      }
      followRef.current = false;
      onSelectShip?.(clickedShip);
    }
  };

  const handleDoubleClick = (e: React.MouseEvent) => {
    const shipId = shipAtPoint(e);
    const ship = presentation.ships.find((s) => s.id === shipId && s.isAlive && !s.isDocked);
    if (ship) {
      cameraRef.current.x = -ship.pos[0] * cameraRef.current.zoom;
      cameraRef.current.y = -ship.pos[1] * cameraRef.current.zoom;
      followRef.current = true;
      onSelectShip?.(ship.id);
    } else if (!projectileAtMouse(e, false)) {
      if (cameraRef.current.pitchDeg < 90) {
        cameraRef.current.pitchDeg = 90;
        setPitchDeg(90);
      } else {
        followRef.current = false;
        cameraRef.current.x = 0;
        cameraRef.current.y = 0;
      }
    }
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const x = ((e.clientX - rect.left) * canvas.width) / rect.width - canvas.width / 2;
      const y =
        (((e.clientY - rect.top) * canvas.height) / rect.height - canvas.height / 2) /
        pitchVerticalScale(cameraRef.current.pitchDeg);
      const camera = cameraRef.current;
      const zoomFactor = e.deltaY < 0 ? 1.1 : 0.9;
      const zoom = Math.max(0.3, Math.min(2.5, camera.zoom * zoomFactor));
      const ratio = zoom / camera.zoom;
      camera.x = x - (x - camera.x) * ratio;
      camera.y = y - (y - camera.y) * ratio;
      camera.zoom = zoom;
    };
    canvas.addEventListener("wheel", onWheel, { passive: false });
    return () => canvas.removeEventListener("wheel", onWheel);
  }, []);

  return (
    <div className="relative w-full h-full overflow-hidden select-none cursor-grab active:cursor-grabbing">
      <canvas
        ref={canvasRef}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={() => {
          dragModeRef.current = null;
        }}
        onDoubleClick={handleDoubleClick}
        className="w-full h-full block"
      />
      {pitchDeg < 89.5 && (
        <button
          type="button"
          className="absolute bottom-3 left-3 rounded-full border border-cyan-700 bg-slate-950/90 px-3 py-1 text-xs text-cyan-200 cursor-pointer"
          onClick={() => {
            cameraRef.current.pitchDeg = 90;
            setPitchDeg(90);
          }}
        >
          2.5D Tilt: {Math.round(pitchDeg)}° · Reset (90°)
        </button>
      )}
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
    const members = ships.filter(
      (ship) => ship.isAlive && !ship.isDocked && wing.members.includes(ship.id),
    );
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

function drawRadiationInterference(
  ctx: CanvasRenderingContext2D,
  viewport: Viewport,
  zoom: number,
  time: number,
): void {
  const furthestX = Math.max(Math.abs(viewport.minX), Math.abs(viewport.maxX));
  const furthestY = Math.max(Math.abs(viewport.minY), Math.abs(viewport.maxY));
  if (Math.hypot(furthestX, furthestY) <= ARENA_RADIUS) return;

  const width = viewport.maxX - viewport.minX;
  const height = viewport.maxY - viewport.minY;
  const pixel = 1 / zoom;
  const phase = time * 0.7;
  const frame = Math.floor(phase);
  const blend = (1 - Math.cos((phase - frame) * Math.PI)) / 2;
  const random = (seed: number) => {
    const value = Math.sin(seed * 127.1 + 311.7) * 43758.5453;
    return value - Math.floor(value);
  };

  ctx.save();
  ctx.beginPath();
  ctx.rect(viewport.minX, viewport.minY, width, height);
  ctx.moveTo(ARENA_RADIUS, 0);
  ctx.arc(0, 0, ARENA_RADIUS, 0, Math.PI * 2);
  ctx.clip("evenodd");

  // Crossfade sparse sensor grain rather than replacing every hit at once.
  ctx.fillStyle = "#c5ffda";
  for (let layer = 0; layer < 2; layer++) {
    const opacity = layer === 0 ? 1 - blend : blend;
    for (let i = 0; i < 1000; i++) {
      const seed = (frame + layer) * 4000 + i * 4;
      const x = viewport.minX + random(seed) * width;
      const y = viewport.minY + random(seed + 1) * height;
      const radius = Math.hypot(x, y);
      const depth = radius - ARENA_RADIUS;
      if (depth <= 0) continue;
      const bufferWidth = Math.max(1, ARENA_HARD_PULL_RADIUS - ARENA_RADIUS);
      const buffer = Math.min(1, depth / bufferWidth);
      const deep = Math.min(1, Math.max(0, radius - ARENA_HARD_PULL_RADIUS) / bufferWidth);
      const smoothBuffer = buffer * buffer * (3 - 2 * buffer);
      const smoothDeep = deep * deep * (3 - 2 * deep);
      if (i >= 650 && deep === 0) continue;
      const intensity = 0.35 * smoothBuffer + 0.65 * smoothDeep;
      const hit = random(seed + 2);
      ctx.globalAlpha = opacity * intensity * (i >= 650 ? smoothDeep : 1) * (0.06 + hit * 0.16);
      const length = 1 + hit * 2 + smoothDeep * (0.5 + hit * 1.5);
      ctx.fillRect(x, y, length * pixel, pixel);
    }
  }
  ctx.restore();
}

function drawTacticalGrid(ctx: CanvasRenderingContext2D, time: number, pitchDeg: number): void {
  const gridSize = 100;
  const radius = ARENA_RADIUS;
  const tilt = Math.cos((pitchDeg * Math.PI) / 180);
  const verticalScale = pitchVerticalScale(pitchDeg);

  ctx.save();

  ctx.save();
  ctx.beginPath();
  ctx.arc(0, 0, radius, 0, Math.PI * 2);
  ctx.clip();
  if (tilt > 0.01) {
    const fade = ctx.createLinearGradient(0, -radius, 0, radius);
    fade.addColorStop(0, "rgba(30, 56, 75, 0.08)");
    fade.addColorStop(0.55, "rgba(30, 56, 75, 0.2)");
    fade.addColorStop(1, "rgba(30, 56, 75, 0.32)");
    ctx.strokeStyle = fade;
  } else {
    ctx.strokeStyle = "rgba(30, 41, 59, 0.4)";
  }
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
  ctx.restore();

  const shimmer = 0.2 + 0.05 * Math.sin(time * 0.7);
  ctx.strokeStyle = `rgba(103, 232, 249, ${shimmer * (1 - tilt * 0.45)})`;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(0, 0, radius, 0, Math.PI * 2);
  ctx.stroke();
  if (tilt > 0.01) {
    // Fade the raised rear arc into space rather than closing it with cage uprights.
    const height = (Math.min(radius * 0.08, 180) * tilt) / verticalScale;
    const arcFade = ctx.createLinearGradient(-radius, 0, radius, 0);
    arcFade.addColorStop(0, "rgba(103, 232, 249, 0)");
    arcFade.addColorStop(0.25, `rgba(103, 232, 249, ${0.06 * tilt})`);
    arcFade.addColorStop(0.75, `rgba(103, 232, 249, ${0.06 * tilt})`);
    arcFade.addColorStop(1, "rgba(103, 232, 249, 0)");
    ctx.strokeStyle = arcFade;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.ellipse(0, -height, radius, radius, 0, Math.PI, Math.PI * 2);
    ctx.stroke();
  }
  ctx.strokeStyle = "rgba(251, 191, 36, 0.2)";
  ctx.lineWidth = 1;
  ctx.setLineDash([12, 10]);
  ctx.beginPath();
  ctx.arc(0, 0, ARENA_HARD_PULL_RADIUS, 0, Math.PI * 2);
  ctx.stroke();
  ctx.setLineDash([]);

  const labelOpacity = Math.min(1, Math.max(0, (pitchDeg - 45) / 15));
  if (labelOpacity > 0) {
    ctx.save();
    ctx.globalAlpha *= labelOpacity;
    ctx.fillStyle = "rgba(103, 232, 249, 0.6)";
    ctx.font = "10px monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const shieldLabel = "CONTAINMENT SHIELD BOUNDARY • 100% ATTENUATION";
    const label = (text: string, y: number) => {
      ctx.save();
      ctx.translate(0, y);
      ctx.scale(1, 1 / verticalScale);
      ctx.fillText(text, 0, 0);
      ctx.restore();
    };
    label(shieldLabel, -radius + 18 / verticalScale);
    label(shieldLabel, radius - 18 / verticalScale);
    ctx.fillStyle = "rgba(251, 191, 36, 0.55)";
    const bufferLabel = "IONIZING BUFFER ZONE • PARTIAL DAMPENING";
    const bufferCenter = (radius + ARENA_HARD_PULL_RADIUS) / 2;
    label(bufferLabel, -bufferCenter);
    label(bufferLabel, bufferCenter);
    label("☢ DEEP COSMIC RADIATION HAZARD", -ARENA_HARD_PULL_RADIUS - 20 / verticalScale);
    label("☢ DEEP COSMIC RADIATION HAZARD", ARENA_HARD_PULL_RADIUS + 20 / verticalScale);
    ctx.restore();
  }

  ctx.restore();
}

function drawRadiationWarning(ctx: CanvasRenderingContext2D, ship: ShipState, time: number): void {
  const radius = Math.max(ship.size * 1.5, shieldEnvelopeRadius(ship)) + 7;
  const pulse = 0.4 + 0.2 * Math.sin(time * 4);
  ctx.save();
  ctx.strokeStyle = `rgba(202, 204, 42, ${pulse})`;
  ctx.lineWidth = 1.5;
  ctx.setLineDash([5, 4]);
  ctx.beginPath();
  ctx.arc(ship.pos[0], ship.pos[1], radius, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = `rgba(250, 204, 21, ${pulse + 0.25})`;
  ctx.font = "10px monospace";
  ctx.textAlign = "center";
  ctx.fillText("☢ RAD", ship.pos[0], ship.pos[1] - radius - 5);
  ctx.restore();
}

function drawTacticalTrajectory(
  ctx: CanvasRenderingContext2D,
  ship: ShipState,
  sim: TacticalPresentationState,
  wings: FighterWingVisual[],
): void {
  if (ship.isDebris) {
    const label = "KINETIC DEBRIS • DRIFTING";
    const x = ship.pos[0];
    const y = ship.pos[1] + ship.size + 18;
    ctx.save();
    ctx.font = "10px monospace";
    const width = ctx.measureText(label).width + 16;
    ctx.fillStyle = "rgba(10, 15, 26, 0.85)";
    ctx.strokeStyle = "#94a3b8";
    ctx.lineWidth = 1;
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(x - width / 2, y - 4, width, 18, 4);
    else ctx.rect(x - width / 2, y - 4, width, 18);
    ctx.fill();
    ctx.stroke();
    ctx.textAlign = "center";
    ctx.fillStyle = "#94a3b8";
    ctx.fillText(label, x, y + 9);
    ctx.restore();
    return;
  }
  const isBlue = ship.team === 0;
  const primaryColor = isBlue ? "#38bdf8" : "#f87171";
  const speed = Math.hypot(ship.velocity[0], ship.velocity[1]);
  const auxiliaries =
    ship.hullClass === "carrier"
      ? sim.ships.filter(
          (s) =>
            s.isAlive &&
            s.flagshipId === ship.id &&
            (s.hullClass === "strike_craft" || s.hullClass === "corvette"),
        )
      : [];
  if (ship.hullClass === "carrier") {
    ctx.save();
    ctx.strokeStyle = primaryColor;
    ctx.globalAlpha = 0.65;
    ctx.lineWidth = 1.2;
    ctx.setLineDash([4, 6]);
    ctx.beginPath();
    for (const craft of auxiliaries) {
      if (craft.isDocked || !(craft.carrierRecovering || craft.fighterPhase === "recover"))
        continue;
      ctx.moveTo(...craft.pos);
      ctx.lineTo(...ship.pos);
    }
    ctx.stroke();
    ctx.restore();
  }

  // 1. Target Lock & Engagement Line
  const targetId =
    ship.navigationTargetId ??
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
    const br = Math.max(shieldEnvelopeRadius(target), 20);
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
  const tier = sim.crewVeterancy?.[ship.team] ?? "pilot";
  const line1 = `SPD: ${Math.round(speed)} u/s • ${tier.toUpperCase()} • ${intent}`;
  const line2 = target
    ? `TGT: ${target.name} [${Math.round(Math.hypot(target.pos[0] - ship.pos[0], target.pos[1] - ship.pos[1]))}u]`
    : null;
  const sideTarget = ship.navigationTargetId
    ? sim.ships.find(
        (candidate) =>
          candidate.isAlive &&
          candidate.team !== ship.team &&
          candidate.id !== ship.navigationTargetId &&
          candidate.id !== targetId &&
          ship.turrets.some(
            (turret) =>
              turret.currentTargetKind !== "missile" && turret.currentTargetId === candidate.id,
          ),
      )
    : undefined;
  const sideLine = sideTarget
    ? `SIDE TGT: ${sideTarget.name} (${Math.round(Math.hypot(sideTarget.pos[0] - ship.pos[0], sideTarget.pos[1] - ship.pos[1]))}u)`
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
  if (ship.hullClass === "carrier") {
    const repairing = auxiliaries.filter(
      (craft) => craft.isDocked && craft.hangarTurnaroundUntil !== undefined,
    ).length;
    const ready = auxiliaries.filter(
      (craft) => craft.isDocked && craft.hangarTurnaroundUntil === undefined,
    ).length;
    const airborne = auxiliaries.filter((craft) => !craft.isDocked).length;
    wingLines.push(`HANGAR: ${repairing} in repair • ${ready} ready • ${airborne} airborne`);
    const fabrication = sim.getCarrierFabrication(ship);
    wingLines.push(
      fabrication.currentWings >= fabrication.maxWings
        ? "FAB: FULL"
        : `FAB: +2 in ${Math.ceil(fabrication.timerRemaining)}s`,
    );
  }
  if (ship.hullClass === "strike_craft" && wingLines.length === 0)
    wingLines.push("ECHELON PENDING");

  ctx.save();
  ctx.font = "10px monospace";
  const w1 = ctx.measureText(line1).width;
  const w2 = line2 ? ctx.measureText(line2).width : 0;
  const boxW =
    Math.max(
      w1,
      w2,
      sideLine ? ctx.measureText(sideLine).width : 0,
      ...wingLines.map((line) => ctx.measureText(line).width),
    ) + 16;
  const boxH = 18 + (line2 ? 13 : 0) + (sideLine ? 13 : 0) + wingLines.length * 13;

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
  if (sideLine) {
    ctx.fillStyle = "#c4b5fd";
    ctx.fillText(sideLine, pillX, pillY + 22 + (line2 ? 13 : 0));
  }
  ctx.fillStyle = "#fbbf24";
  wingLines.forEach((line, index) => {
    ctx.fillText(line, pillX, pillY + 22 + (line2 ? 13 : 0) + (sideLine ? 13 : 0) + index * 13);
  });
  ctx.restore();
}

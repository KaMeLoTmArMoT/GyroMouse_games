import { X } from "lucide-react";
import { useEffect, useRef } from "react";
import { SHIELD_HAVEN_SLOTS } from "../engine/shieldHaven";
import { SHIP_DOCTRINES } from "../engine/shipDoctrines";
import { HULL_PROFILES } from "../engine/shipProfiles";
import type { HullClass } from "../types/combat";

export function DoctrineDialog({
  hull,
  onClose,
  redTeam = false,
}: {
  hull: HullClass;
  onClose: () => void;
  redTeam?: boolean;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const doctrine = SHIP_DOCTRINES[hull];
  const flight = doctrine.flight;
  const profile = HULL_PROFILES[hull];
  const primary =
    flight.kind === "capital"
      ? profile.turrets.find((turret) =>
          flight.primaryMount === "spinal"
            ? turret.isSpinalGimbal
            : turret.weapon.weaponType === "missile",
        )
      : undefined;
  const offensiveMounts = profile.turrets.filter(
    (turret) => turret.weapon.weaponType !== "point_defense",
  );
  const primaryRange =
    primary?.weapon.range ?? Math.max(0, ...offensiveMounts.map((turret) => turret.weapon.range));
  const secondaryRange =
    Math.max(
      0,
      ...offensiveMounts
        .filter((turret) => turret !== primary)
        .map((turret) => turret.weapon.range),
    ) || primaryRange;

  useEffect(() => {
    const dialog = dialogRef.current;
    dialog?.showModal();
    return () => dialog?.close();
  }, []);

  return (
    <dialog
      ref={dialogRef}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      aria-labelledby="doctrine-title"
      className={`m-auto w-[min(32rem,calc(100%-2rem))] max-h-[85vh] overflow-y-auto rounded-xl border bg-zinc-950 p-0 text-zinc-100 shadow-xl shadow-black/50 backdrop:bg-black/70 ${redTeam ? "border-red-900/40" : "border-cyan-500/40"}`}
    >
      <div className="p-5 space-y-4">
        <header className="flex items-start justify-between gap-4">
          <div>
            <p
              className={`text-[11px] font-mono uppercase tracking-wider ${redTeam ? "text-red-400" : "text-cyan-400"}`}
            >
              Tactical doctrine &amp; state machine
            </p>
            <h2 id="doctrine-title" className="mt-1 text-lg font-semibold">
              {profile.name}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close doctrine"
            className="rounded-md p-1 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100 cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </header>
        <dl className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
          <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-2">
            <dt className="text-zinc-500 uppercase">Flight kind</dt>
            <dd className={`mt-1 ${redTeam ? "text-red-300" : "text-cyan-300"}`}>{flight.kind}</dd>
          </div>
          <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-2">
            <dt className="text-zinc-500 uppercase">Speed</dt>
            <dd className={`mt-1 ${redTeam ? "text-red-300" : "text-cyan-300"}`}>
              {profile.speed} u/s
            </dd>
          </div>
          {flight.kind === "capital" ? (
            <>
              <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-2">
                <dt className="text-zinc-500 uppercase">Standoff threshold</dt>
                <dd className="mt-1 text-zinc-200">
                  {"distance" in flight.standoffThreshold
                    ? `${flight.standoffThreshold.distance}u`
                    : `Standoff + ${flight.standoffThreshold.margin}u`}
                </dd>
              </div>
              <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-2">
                <dt className="text-zinc-500 uppercase">Optimal standoff (full shields)</dt>
                <dd className="mt-1 text-zinc-200">
                  {Math.min(secondaryRange * 0.9, flight.optimalDistanceLimit)}u · limit{" "}
                  {flight.optimalDistanceLimit}u
                </dd>
                <dd className="mt-1 text-zinc-500">Varies with stance and low shields.</dd>
              </div>
              <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-2">
                <dt className="text-zinc-500 uppercase">Brawl distance</dt>
                <dd className="mt-1 text-zinc-200">{flight.brawlDistance}u</dd>
              </div>
              <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-2">
                <dt className="text-zinc-500 uppercase">Broadside arc offset</dt>
                <dd className="mt-1 text-zinc-200">
                  {Math.round((flight.broadside.arcOffset * 180) / Math.PI)}°
                </dd>
              </div>
              <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-2 sm:col-span-2">
                <dt className="text-zinc-500 uppercase">Formation weaving</dt>
                <dd className="mt-1 text-zinc-200">
                  {flight.formationWeave ? "Enabled with eligible formation peers" : "Disabled"}
                </dd>
              </div>
            </>
          ) : flight.kind === "skirmish" ? (
            <>
              <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-2">
                <dt className="text-zinc-500 uppercase">Desired distance</dt>
                <dd className="mt-1 text-zinc-200">{flight.desiredDistance}u</dd>
              </div>
              <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-2">
                <dt className="text-zinc-500 uppercase">Breakoff angle</dt>
                <dd className="mt-1 text-zinc-200">
                  {Math.round((flight.breakoffAngle * 180) / Math.PI)}°
                </dd>
              </div>
              <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-2">
                <dt className="text-zinc-500 uppercase">Reload breakoff trigger</dt>
                <dd className="mt-1 text-zinc-200">&gt; {flight.breakoffReload.toFixed(1)}s</dd>
              </div>
              <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-2">
                <dt className="text-zinc-500 uppercase">Reacquire trigger</dt>
                <dd className="mt-1 text-zinc-200">&lt; {flight.reacquireReload.toFixed(1)}s</dd>
              </div>
            </>
          ) : (
            <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-2 sm:col-span-2">
              <dt className="text-zinc-500 uppercase">Standoff / station</dt>
              <dd className="mt-1 text-zinc-200">{doctrine.standoff}</dd>
            </div>
          )}
          <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-2 sm:col-span-2">
            <dt className="text-zinc-500 uppercase">Shield Haven eligibility</dt>
            <dd className="mt-1 text-zinc-200">
              {flight.kind === "capital"
                ? `Haven provider · ${Object.keys(SHIELD_HAVEN_SLOTS).length} slots${hull === "cruiser" ? " · strike craft only" : ""}`
                : hull === "missile_frigate"
                  ? "Not eligible for Haven"
                  : "Haven protected · under 30% hull or broken shields"}
            </dd>
          </div>
          <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-2 sm:col-span-2">
            <dt className="text-zinc-500 uppercase">Target priority</dt>
            <dd className="mt-1 text-zinc-200">{doctrine.targetPriority}</dd>
          </div>
        </dl>
        <div>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-zinc-400">
            Tactical flow
          </h3>
          <ol className="space-y-1">
            {doctrine.states.map((state, index) => (
              <li key={state.name}>
                {state.trigger && (
                  <div
                    className={`ml-4 border-l py-1 pl-4 text-[11px] text-zinc-400 ${redTeam ? "border-red-900/40" : "border-cyan-700"}`}
                  >
                    ↓ {state.trigger}
                  </div>
                )}
                <div
                  className={`flex items-center gap-3 rounded-lg border p-2 text-xs ${redTeam ? "border-red-950/60 bg-zinc-900/90 text-rose-300" : "border-cyan-900 bg-cyan-950/30 text-cyan-100"}`}
                >
                  <span className={`font-mono ${redTeam ? "text-red-400" : "text-cyan-500"}`}>
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  {state.name}
                </div>
              </li>
            ))}
          </ol>
        </div>
        {doctrine.note && <p className="text-xs leading-relaxed text-zinc-400">{doctrine.note}</p>}
      </div>
    </dialog>
  );
}

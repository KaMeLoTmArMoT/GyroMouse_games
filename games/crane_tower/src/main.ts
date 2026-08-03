import { SharedAudioManager } from "../../../shared/audioManager";
import { SharedInputManager } from "../../../shared/inputManager";
import { SettingsOverlay } from "../../../shared/settingsOverlay";
import { CraneGameLogic } from "./game/craneGameLogic";
import { CraneGraphicsManager } from "./graphics/craneGraphics";
import { CranePhysicsManager } from "./physics/cranePhysics";

async function main() {
	const canvas = document.getElementById("game-canvas") as HTMLCanvasElement;
	if (!canvas) {
		console.error("Canvas element not found!");
		return;
	}

	// 1. Initialize Audio & Input Managers
	const audio = new SharedAudioManager();
	const input = new SharedInputManager();
	input.settings.mode = "keyboard"; // Dual split keyboard / gyromouse

	// 2. Initialize Physics & Graphics
	const physics = new CranePhysicsManager();
	await physics.init();

	const graphics = new CraneGraphicsManager(canvas);
	graphics.init();

	// 3. Initialize Game Logic & Settings Overlay
	const game = new CraneGameLogic(physics, graphics, audio);

	const settingsOverlay = new SettingsOverlay({
		gameId: "crane_tower",
		inputManager: input,
		onPauseToggle: (paused) => {
			game.isPaused = paused;
		},
		onRestart: () => game.startLevel(game.currentLevel),
		onToggleMute: () => audio.toggleMute(),
	});

	game.settingsOverlay = settingsOverlay;
	game.startLevel(1);

	// 4. Main Game Loop
	let lastTime = performance.now();

	function animate(now: number) {
		requestAnimationFrame(animate);

		const dt = Math.min((now - lastTime) / 1000, 0.05);
		lastTime = now;

		// Update Input
		input.update(dt);

		// Read steering values (steer.x = Left/Right, steer.y = Up/Down pitch)
		const steer = input.getSteeringValue();
		const inputX = steer.x;
		const inputY = -steer.y; // W/Up (steer.y < 0) raises crane (inputY > 0), S/Down (steer.y > 0) lowers crane (inputY < 0)

		if (!game.isPaused) {
			if (game.state === "PLAYING" || game.state === "COUNTDOWN") {
				physics.updateCranePosition(inputX, inputY, dt, false);
			}
			physics.step(dt);
			game.update(dt);
		}

		graphics.syncGraphics(physics);
		graphics.render();
	}

	requestAnimationFrame(animate);
}

main().catch(console.error);

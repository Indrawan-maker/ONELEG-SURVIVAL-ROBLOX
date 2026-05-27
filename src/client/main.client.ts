const Players = game.GetService("Players");
const UserInputService = game.GetService("UserInputService");
const Workspace = game.GetService("Workspace");
const RunService = game.GetService("RunService");

const player = Players.LocalPlayer;

type MoveState = "Idle" | "LimpWalk" | "Charging" | "Launching" | "Airborne" | "Landing";

const CONFIG = {
	walkMinSpeed: 1.2,
	walkMaxSpeed: 4.7,
	walkDeadzoneSpeed: 0.25,
	walkStepRate: 9.6,
	walkStepPulseSharpness: 2.4,
	walkSideDrift: 0.22,
	walkTurnAssist: 0.2,
	walkLean: math.rad(22),
	walkSideWobble: math.rad(19),
	walkHeadBob: math.rad(4),
	walkHipDrop: 0.06,
	walkStepAngularKick: 1.05,

	chargeMoveSpeed: 0.85,
	chargeMaxTime: 0.72,
	chargeMinAnticipation: 0.14,
	chargeLeanBack: math.rad(23),
	chargeSideWobble: math.rad(10),
	chargeShake: math.rad(2.8),
	chargeHipDrop: 0.32,
	directionLockAt: 0.22,

	hopCooldown: 0.08,
	minHopForward: 26,
	maxHopForward: 52,
	minHopUp: 28,
	maxHopUp: 44,
	hopChaosSide: 0.06,
	hopYawSpin: 4.6,
	hopRollSpin: 2.55,
	takeoffDampingXZ: 0.02,
	takeoffDampingY: 0,

	airControl: 0.08,
	airControlMax: 8,

	landingSmallImpact: 18,
	landingBigImpact: 32,
	landingSmallWobble: 3.2,
	landingBigWobble: 6.2,
	landingRecoverySmall: 0.22,
	landingRecoveryBig: 0.46,

	streakResetSeconds: 2,
	cameraChargeFovPull: 1.2,
	cameraHopFovKick: 3.2,
	cameraLandingShake: 0.24,

	buttonBaseSize: 126,
	buttonGrowth: 24,
	buttonX: 0.86,
	buttonY: 0.72,
};

let state: MoveState = "Idle";

let character: Model | undefined;
let humanoid: Humanoid | undefined;
let rootPart: BasePart | undefined;

let rootMotor: Motor6D | undefined;
let waistMotor: Motor6D | undefined;
let neckMotor: Motor6D | undefined;
let leftHipMotor: Motor6D | undefined;
let rightHipMotor: Motor6D | undefined;
let leftKneeMotor: Motor6D | undefined;
let rightKneeMotor: Motor6D | undefined;
let leftShoulderMotor: Motor6D | undefined;
let rightShoulderMotor: Motor6D | undefined;
let leftElbowMotor: Motor6D | undefined;
let rightElbowMotor: Motor6D | undefined;

let originalHipHeight = 0;
let originalFov = 70;

let isCharging = false;
let pendingHop = false;
let directionLocked = false;
let chargeStartTime = 0;
let chargeDirection = new Vector3(0, 0, -1);

let walkCycle = 0;
let lastStepIndex = 0;
let lastWalkDirection = new Vector3(0, 0, -1);
let limpIntensity = 0;
let lastHopTime = 0;
let lastGrounded = false;
let lastVerticalVelocity = 0;
let hopStreak = 0;

let cameraKickUntil = 0;
let cameraKickPower = 0;
let bubbleToken = 0;
let lastBubbleAt = 0;

let screenGui: ScreenGui | undefined;
let hopButton: TextButton | undefined;
let chargeBack: Frame | undefined;
let chargeFill: Frame | undefined;
let bubbleGui: BillboardGui | undefined;
let bubbleLabel: TextLabel | undefined;
let streakLabel: TextLabel | undefined;

function now() {
	return os.clock();
}

function clamp01(value: number) {
	return math.clamp(value, 0, 1);
}

function lerpNumber(a: number, b: number, t: number) {
	return a + (b - a) * t;
}

function smoothStep(t: number) {
	const x = clamp01(t);
	return x * x * (3 - 2 * x);
}

function randomRange(min: number, max: number) {
	return min + math.random() * (max - min);
}

function randomSign() {
	return math.random() < 0.5 ? -1 : 1;
}

function flat(vector: Vector3) {
	return new Vector3(vector.X, 0, vector.Z);
}

function safeUnit(vector: Vector3, fallback: Vector3) {
	if (vector.Magnitude < 0.001) return fallback;
	return vector.Unit;
}

function isAlive() {
	return humanoid !== undefined && rootPart !== undefined && humanoid.Health > 0;
}

function isGrounded() {
	if (!humanoid) return false;
	return humanoid.FloorMaterial !== Enum.Material.Air;
}

function resetMotor(motor: Motor6D | undefined) {
	if (!motor) return;
	motor.Transform = new CFrame();
}

function resetAllMotors() {
	resetMotor(rootMotor);
	resetMotor(waistMotor);
	resetMotor(neckMotor);
	resetMotor(leftHipMotor);
	resetMotor(rightHipMotor);
	resetMotor(leftKneeMotor);
	resetMotor(rightKneeMotor);
	resetMotor(leftShoulderMotor);
	resetMotor(rightShoulderMotor);
	resetMotor(leftElbowMotor);
	resetMotor(rightElbowMotor);
}

function findMotor(model: Model, names: string[]) {
	for (const name of names) {
		const found = model.FindFirstChild(name, true);
		if (found && found.IsA("Motor6D")) {
			return found;
		}
	}
	return undefined;
}

function getCameraDirections() {
	const camera = Workspace.CurrentCamera;

	if (!camera) {
		return {
			forward: new Vector3(0, 0, -1),
			right: new Vector3(1, 0, 0),
		};
	}

	const forward = safeUnit(flat(camera.CFrame.LookVector), new Vector3(0, 0, -1));
	const right = safeUnit(flat(camera.CFrame.RightVector), new Vector3(1, 0, 0));

	return { forward, right };
}

function getKeyboardDirection() {
	const directions = getCameraDirections();
	let result = new Vector3(0, 0, 0);

	if (UserInputService.IsKeyDown(Enum.KeyCode.W)) result = result.add(directions.forward);
	if (UserInputService.IsKeyDown(Enum.KeyCode.S)) result = result.sub(directions.forward);
	if (UserInputService.IsKeyDown(Enum.KeyCode.D)) result = result.add(directions.right);
	if (UserInputService.IsKeyDown(Enum.KeyCode.A)) result = result.sub(directions.right);

	if (result.Magnitude > 0.01) return result.Unit;
	return undefined;
}

function getFacingDirection() {
	if (!rootPart) return getCameraDirections().forward;
	return safeUnit(flat(rootPart.CFrame.LookVector), getCameraDirections().forward);
}

function getMoveDirection() {
	if (humanoid) {
		const move = flat(humanoid.MoveDirection);
		if (move.Magnitude > 0.05) return move.Unit;
	}

	const keyboard = getKeyboardDirection();
	if (keyboard) return keyboard;

	return new Vector3(0, 0, 0);
}

function getHopDirection() {
	const move = getMoveDirection();
	if (move.Magnitude > 0.05) return move.Unit;
	return getFacingDirection();
}

function faceDirection(direction: Vector3, alpha = 1) {
	if (!rootPart) return;
	if (direction.Magnitude < 0.05) return;

	const pos = rootPart.Position;
	const target = pos.add(direction);
	const targetCFrame = CFrame.lookAt(pos, new Vector3(target.X, pos.Y, target.Z));

	if (alpha >= 1) {
		rootPart.CFrame = targetCFrame;
	} else {
		rootPart.CFrame = rootPart.CFrame.Lerp(targetCFrame, alpha);
	}
}

function makeCorner(parent: GuiObject, radius: number) {
	const corner = new Instance("UICorner");
	corner.CornerRadius = new UDim(0, radius);
	corner.Parent = parent;
	return corner;
}

function makeStroke(parent: GuiObject, thickness: number, transparency: number) {
	const stroke = new Instance("UIStroke");
	stroke.Thickness = thickness;
	stroke.Color = Color3.fromRGB(255, 255, 255);
	stroke.Transparency = transparency;
	stroke.Parent = parent;
	return stroke;
}

function clearOldUi(playerGui: PlayerGui) {
	const old = playerGui.FindFirstChild("OneLegLimpHopUI");
	if (old) old.Destroy();
}

function createUi() {
	const playerGui = player.WaitForChild("PlayerGui") as PlayerGui;
	clearOldUi(playerGui);

	screenGui = new Instance("ScreenGui");
	screenGui.Name = "OneLegLimpHopUI";
	screenGui.IgnoreGuiInset = true;
	screenGui.ResetOnSpawn = false;
	screenGui.Parent = playerGui;

	chargeBack = new Instance("Frame");
	chargeBack.Name = "ChargeBack";
	chargeBack.Size = UDim2.fromOffset(170, 14);
	chargeBack.Position = UDim2.fromScale(CONFIG.buttonX, 0.585);
	chargeBack.AnchorPoint = new Vector2(0.5, 0.5);
	chargeBack.BackgroundColor3 = Color3.fromRGB(18, 18, 20);
	chargeBack.BackgroundTransparency = 0.22;
	chargeBack.BorderSizePixel = 0;
	chargeBack.Parent = screenGui;
	makeCorner(chargeBack, 14);

	chargeFill = new Instance("Frame");
	chargeFill.Name = "ChargeFill";
	chargeFill.Size = UDim2.fromScale(0, 1);
	chargeFill.BackgroundColor3 = Color3.fromRGB(110, 6, 255);
	chargeFill.BorderSizePixel = 0;
	chargeFill.Parent = chargeBack;
	makeCorner(chargeFill, 14);

	hopButton = new Instance("TextButton");
	hopButton.Name = "HopButton";
	hopButton.Size = UDim2.fromOffset(CONFIG.buttonBaseSize, CONFIG.buttonBaseSize);
	hopButton.Position = UDim2.fromScale(CONFIG.buttonX, CONFIG.buttonY);
	hopButton.AnchorPoint = new Vector2(0.5, 0.5);
	hopButton.BackgroundColor3 = Color3.fromRGB(110, 6, 255);
	hopButton.BackgroundTransparency = 0.08;
	hopButton.BorderSizePixel = 0;
	hopButton.Text = "HOP";
	hopButton.TextColor3 = Color3.fromRGB(255, 255, 255);
	hopButton.TextScaled = true;
	hopButton.Font = Enum.Font.GothamBlack;
	hopButton.Parent = screenGui;
	makeCorner(hopButton, 90);
	makeStroke(hopButton, 4, 0.25);

	streakLabel = new Instance("TextLabel");
	streakLabel.Name = "Streak";
	streakLabel.Size = UDim2.fromOffset(190, 36);
	streakLabel.Position = UDim2.fromScale(0.5, 0.18);
	streakLabel.AnchorPoint = new Vector2(0.5, 0.5);
	streakLabel.BackgroundTransparency = 1;
	streakLabel.Text = "";
	streakLabel.Visible = false;
	streakLabel.TextColor3 = Color3.fromRGB(255, 255, 255);
	streakLabel.TextStrokeColor3 = Color3.fromRGB(0, 0, 0);
	streakLabel.TextStrokeTransparency = 0.2;
	streakLabel.TextScaled = true;
	streakLabel.Font = Enum.Font.GothamBold;
	streakLabel.Parent = screenGui;

	hopButton.InputBegan.Connect((input) => {
		if (input.UserInputType === Enum.UserInputType.Touch || input.UserInputType === Enum.UserInputType.MouseButton1) {
			startCharge();
		}
	});

	hopButton.InputEnded.Connect((input) => {
		if (input.UserInputType === Enum.UserInputType.Touch || input.UserInputType === Enum.UserInputType.MouseButton1) {
			releaseCharge();
		}
	});
}

function createWorldBubble() {
	if (!character) return;

	if (bubbleGui) bubbleGui.Destroy();

	const head = character.FindFirstChild("Head");
	if (!head || !head.IsA("BasePart")) return;

	bubbleGui = new Instance("BillboardGui");
	bubbleGui.Name = "OneLegBubble";
	bubbleGui.Adornee = head;
	bubbleGui.Size = UDim2.fromOffset(180, 56);
	bubbleGui.StudsOffset = new Vector3(0, 2.75, 0);
	bubbleGui.AlwaysOnTop = true;
	bubbleGui.Enabled = false;
	bubbleGui.Parent = head;

	bubbleLabel = new Instance("TextLabel");
	bubbleLabel.Size = UDim2.fromScale(1, 1);
	bubbleLabel.BackgroundTransparency = 1;
	bubbleLabel.Text = "";
	bubbleLabel.TextColor3 = Color3.fromRGB(255, 255, 255);
	bubbleLabel.TextStrokeColor3 = Color3.fromRGB(0, 0, 0);
	bubbleLabel.TextStrokeTransparency = 0.1;
	bubbleLabel.TextScaled = true;
	bubbleLabel.Font = Enum.Font.GothamBlack;
	bubbleLabel.Parent = bubbleGui;
}

function showBubble(text: "HOLD!" | "BOING!" | "BONK!", duration = 0.28) {
	if (!bubbleGui || !bubbleLabel) return;
	if (now() - lastBubbleAt < 0.08 && text !== "BONK!") return;

	lastBubbleAt = now();
	bubbleToken++;
	const token = bubbleToken;

	bubbleGui.Enabled = true;
	bubbleLabel.Text = text;
	bubbleLabel.TextColor3 = Color3.fromRGB(255, 255, 255);
	bubbleLabel.Rotation = math.random(-7, 7);

	task.delay(duration, () => {
		if (token !== bubbleToken) return;
		if (bubbleGui) bubbleGui.Enabled = false;
	});
}

function updateStreakUi() {
	if (!streakLabel) return;

	if (hopStreak >= 2) {
		streakLabel.Visible = true;
		streakLabel.Text = `x${hopStreak}`;
	} else {
		streakLabel.Visible = false;
		streakLabel.Text = "";
	}
}

function updateHopButton(alpha: number) {
	const eased = smoothStep(alpha);

	if (hopButton) {
		const size = CONFIG.buttonBaseSize + eased * CONFIG.buttonGrowth;
		hopButton.Size = UDim2.fromOffset(size, size);
		hopButton.Rotation = isCharging ? math.sin(now() * 21) * 4 * eased : 0;
		hopButton.Text = isCharging ? (alpha > 0.92 ? "MAX" : "HOLD") : "HOP";
		hopButton.BackgroundColor3 = Color3.fromRGB(110, 6, 255);
		hopButton.TextColor3 = Color3.fromRGB(255, 255, 255);
	}

	if (chargeFill) {
		chargeFill.Size = UDim2.fromScale(eased, 1);
		chargeFill.BackgroundColor3 = Color3.fromRGB(110, 6, 255);
	}
}


function disableDefaultAnimate(model: Model) {
	const animate = model.FindFirstChild("Animate");
	if (animate && animate.IsA("LocalScript")) {
		animate.Disabled = true;
	}

	const hum = model.FindFirstChildOfClass("Humanoid");
	if (!hum) return;

	const animator = hum.FindFirstChildOfClass("Animator");
	if (!animator) return;

	for (const track of animator.GetPlayingAnimationTracks()) {
		track.Stop(0);
	}
}

function setupCharacter(model: Model) {
	disableDefaultAnimate(model);

	character = model;
	humanoid = model.WaitForChild("Humanoid") as Humanoid;
	rootPart = model.WaitForChild("HumanoidRootPart") as BasePart;

	rootMotor = findMotor(model, ["Root", "RootJoint"]);
	waistMotor = findMotor(model, ["Waist"]);
	neckMotor = findMotor(model, ["Neck"]);
	leftHipMotor = findMotor(model, ["LeftHip", "Left Hip"]);
	rightHipMotor = findMotor(model, ["RightHip", "Right Hip"]);
	leftKneeMotor = findMotor(model, ["LeftKnee"]);
	rightKneeMotor = findMotor(model, ["RightKnee"]);
	leftShoulderMotor = findMotor(model, ["LeftShoulder", "Left Shoulder"]);
	rightShoulderMotor = findMotor(model, ["RightShoulder", "Right Shoulder"]);
	leftElbowMotor = findMotor(model, ["LeftElbow", "Left Elbow"]);
	rightElbowMotor = findMotor(model, ["RightElbow", "Right Elbow"]);

	originalHipHeight = humanoid.HipHeight;

	const camera = Workspace.CurrentCamera;
	if (camera) originalFov = camera.FieldOfView;

	humanoid.UseJumpPower = true;
	humanoid.JumpPower = 0;
	humanoid.JumpHeight = 0;
	humanoid.WalkSpeed = CONFIG.walkMaxSpeed;
	humanoid.AutoRotate = false;

	walkCycle = 0;
	lastStepIndex = 0;
	limpIntensity = 0;
	lastHopTime = 0;
	hopStreak = 0;
	state = "Idle";
	isCharging = false;
	pendingHop = false;
	directionLocked = false;

	resetAllMotors();
	createWorldBubble();
	updateStreakUi();

	humanoid.StateChanged.Connect((_, newState) => {
		if (newState === Enum.HumanoidStateType.Freefall) {
			if (state !== "Charging") state = "Airborne";
		}

		if (newState === Enum.HumanoidStateType.Landed) {
			handleLanding();
		}
	});
}

function getChargeAlpha() {
	if (!isCharging) return 0;
	return clamp01((now() - chargeStartTime) / CONFIG.chargeMaxTime);
}

function getHopPower(alpha: number) {
	return smoothStep(math.max(alpha, 0.18));
}

function updateChargeDirection(alpha: number) {
	if (directionLocked) return;

	const input = getHopDirection();
	if (input.Magnitude > 0.05) chargeDirection = input.Unit;

	if (alpha >= CONFIG.directionLockAt) {
		directionLocked = true;
	}
}

function applyChargePose(alpha: number) {
	if (!humanoid || !rootPart) return;

	updateChargeDirection(alpha);
	faceDirection(chargeDirection, 1);

	const eased = smoothStep(alpha);
	const t = now();

	const wobble = math.sin(t * 22) * CONFIG.chargeSideWobble * eased;
	const shake = math.sin(t * 44) * CONFIG.chargeShake * eased;
	const lean = -CONFIG.chargeLeanBack * eased;

	if (rootMotor) rootMotor.Transform = CFrame.Angles(lean + shake, 0, wobble);
	if (waistMotor) waistMotor.Transform = CFrame.Angles(math.rad(5) * eased, 0, -wobble * 0.45);
	if (neckMotor) neckMotor.Transform = CFrame.Angles(math.rad(7) * eased, 0, wobble * 0.25);

	if (leftHipMotor) leftHipMotor.Transform = CFrame.Angles(math.rad(18) * eased, 0, math.rad(7) * eased);
	if (leftKneeMotor) leftKneeMotor.Transform = CFrame.Angles(-math.rad(16) * eased, 0, 0);
	if (rightHipMotor) rightHipMotor.Transform = CFrame.Angles(-math.rad(10) * eased, 0, -math.rad(8) * eased);
	if (rightKneeMotor) rightKneeMotor.Transform = CFrame.Angles(math.rad(10) * eased, 0, 0);

	if (leftShoulderMotor) leftShoulderMotor.Transform = CFrame.Angles(0, 0, math.rad(12) * eased);
	if (rightShoulderMotor) rightShoulderMotor.Transform = CFrame.Angles(0, 0, -math.rad(12) * eased);

	humanoid.HipHeight = originalHipHeight - CONFIG.chargeHipDrop * eased;
	humanoid.WalkSpeed = CONFIG.chargeMoveSpeed;

	updateHopButton(alpha);
	showBubble("HOLD!", 0.12);
}

function resetPose() {
	if (humanoid) {
		humanoid.HipHeight = originalHipHeight;
		humanoid.WalkSpeed = CONFIG.walkMaxSpeed;
	}
	resetAllMotors();
	updateHopButton(0);
}

function startCharge() {
	if (!isAlive()) return;
	if (!humanoid || !rootPart) return;
	if (isCharging || pendingHop) return;
	if (!isGrounded()) return;
	if (now() - lastHopTime < CONFIG.hopCooldown) return;

	isCharging = true;
	pendingHop = false;
	directionLocked = false;
	chargeStartTime = now();
	chargeDirection = getHopDirection();
	state = "Charging";

	showBubble("HOLD!", 0.2);
	applyChargePose(0.08);
}

function releaseCharge() {
	if (!isCharging) return;

	const held = now() - chargeStartTime;

	if (held < CONFIG.chargeMinAnticipation) {
		pendingHop = true;

		task.delay(CONFIG.chargeMinAnticipation - held, () => {
			if (!isCharging || !pendingHop) return;

			const alpha = getChargeAlpha();
			isCharging = false;
			pendingHop = false;
			performHop(alpha);
		});

		return;
	}

	const alpha = getChargeAlpha();
	isCharging = false;
	pendingHop = false;
	performHop(alpha);
}

function performHop(chargeAlpha: number) {
	if (!isAlive()) return;
	if (!humanoid || !rootPart) return;

	if (!isGrounded()) {
		resetPose();
		state = "Airborne";
		return;
	}

	const power = getHopPower(chargeAlpha);
	const forward = lerpNumber(CONFIG.minHopForward, CONFIG.maxHopForward, power);
	const up = lerpNumber(CONFIG.minHopUp, CONFIG.maxHopUp, power);
	const direction = safeUnit(chargeDirection, getHopDirection());
	const mass = rootPart.AssemblyMass;

	faceDirection(direction, 1);
	resetPose();
	state = "Launching";

	const oldVelocity = rootPart.AssemblyLinearVelocity;
	rootPart.AssemblyLinearVelocity = new Vector3(
		oldVelocity.X * CONFIG.takeoffDampingXZ,
		oldVelocity.Y * CONFIG.takeoffDampingY,
		oldVelocity.Z * CONFIG.takeoffDampingXZ,
	);

	humanoid.ChangeState(Enum.HumanoidStateType.Jumping);

	const side = randomRange(-1, 1);
	const finalDirection = safeUnit(
		new Vector3(direction.X + side * CONFIG.hopChaosSide, 0, direction.Z + side * CONFIG.hopChaosSide),
		direction,
	);

	rootPart.ApplyImpulse(new Vector3(finalDirection.X * forward * mass, up * mass, finalDirection.Z * forward * mass));

	const spinDirection = randomSign();
	const spinPower = 0.75 + power * 0.65;
	rootPart.AssemblyAngularVelocity = new Vector3(
		CONFIG.hopRollSpin * spinDirection * spinPower,
		CONFIG.hopYawSpin * spinDirection * spinPower,
		CONFIG.hopRollSpin * side * spinPower,
	);

	applyTakeoffPose(power);
	cameraKick(0.45 + power * 0.55);

	lastHopTime = now();
	hopStreak++;
	updateStreakUi();

	showBubble("BOING!", 0.3);

	task.delay(0.1, () => {
		if (state === "Launching") {
			state = "Airborne";
			applyAirPose(power);
		}
	});
}

function applyTakeoffPose(power: number) {
	const side = randomRange(-1, 1);

	if (rootMotor) rootMotor.Transform = CFrame.Angles(math.rad(15) * power, 0, math.rad(7) * side * power);
	if (waistMotor) waistMotor.Transform = CFrame.Angles(math.rad(7) * power, 0, -math.rad(5) * side * power);
	if (neckMotor) neckMotor.Transform = CFrame.Angles(-math.rad(5) * power, 0, math.rad(4) * side * power);
	if (leftHipMotor) leftHipMotor.Transform = CFrame.Angles(math.rad(23) * power, 0, math.rad(7) * side);
	if (rightHipMotor) rightHipMotor.Transform = CFrame.Angles(-math.rad(13) * power, 0, -math.rad(7) * side);
}

function applyAirPose(power: number) {
	const side = randomRange(-1, 1);

	if (rootMotor) rootMotor.Transform = CFrame.Angles(math.rad(8) * power, 0, math.rad(8) * side * power);
	if (waistMotor) waistMotor.Transform = CFrame.Angles(math.rad(4) * power, 0, -math.rad(4) * side * power);
	if (neckMotor) neckMotor.Transform = CFrame.Angles(math.rad(4) * power, 0, math.rad(4) * side * power);
}

function applyLandingPose(big: boolean) {
	const strength = big ? 1 : 0.62;
	const side = randomRange(-1, 1);

	if (rootMotor) rootMotor.Transform = CFrame.Angles(-math.rad(10) * strength, 0, math.rad(13) * side * strength);
	if (waistMotor) waistMotor.Transform = CFrame.Angles(math.rad(7) * strength, 0, -math.rad(8) * side * strength);
	if (neckMotor) neckMotor.Transform = CFrame.Angles(math.rad(7) * strength, 0, math.rad(8) * side * strength);
	if (humanoid) humanoid.HipHeight = originalHipHeight - 0.16 * strength;

	task.delay(big ? CONFIG.landingRecoveryBig : CONFIG.landingRecoverySmall, () => {
		if (state === "Landing") {
			resetPose();
			state = "Idle";
		}
	});
}

function handleLanding() {
	if (!rootPart) return;
	if (now() - lastHopTime < 0.08) return;

	const impact = math.abs(lastVerticalVelocity);
	const big = impact > CONFIG.landingBigImpact;
	const side = randomRange(-1, 1);
	const wobble = big ? CONFIG.landingBigWobble : CONFIG.landingSmallWobble;

	state = "Landing";
	rootPart.AssemblyAngularVelocity = rootPart.AssemblyAngularVelocity.add(
		new Vector3(wobble * side, wobble * 0.35, -wobble * side),
	);

	applyLandingPose(big);
	cameraKick(big ? 0.8 : 0.38);
	showBubble("BONK!", big ? 0.35 : 0.22);
}

function updateLimpWalk(dt: number) {
	if (!humanoid || !rootPart) return;

	if (isCharging) return;
	if (!isGrounded()) return;

	const moveDirection = getMoveDirection();
	const moving = moveDirection.Magnitude > 0.05;

	if (!moving) {
		limpIntensity = math.max(0, limpIntensity - dt * 5);
		walkCycle = 0;
		lastStepIndex = 0;
		humanoid.WalkSpeed = CONFIG.walkDeadzoneSpeed;

		if (state === "LimpWalk") {
			state = "Idle";
			resetPose();
		}

		return;
	}

	state = "LimpWalk";
	lastWalkDirection = moveDirection.Unit;
	limpIntensity = math.min(1, limpIntensity + dt * 4.5);

	const inputStrength = math.clamp(humanoid.MoveDirection.Magnitude, 0, 1);
	const rate = CONFIG.walkStepRate * lerpNumber(0.85, 1.25, inputStrength);
	walkCycle += dt * rate;

	const rawStep = math.sin(walkCycle * math.pi * 2);
	const plant = rawStep > 0 ? 1 : 0;
	const pulse = math.pow(math.abs(rawStep), CONFIG.walkStepPulseSharpness);

	const speedPulse = plant === 1 ? pulse : pulse * 0.38;
	const targetSpeed = lerpNumber(CONFIG.walkMinSpeed, CONFIG.walkMaxSpeed, speedPulse) * limpIntensity;

	humanoid.WalkSpeed = math.clamp(targetSpeed, CONFIG.walkMinSpeed, CONFIG.walkMaxSpeed);
	faceDirection(lastWalkDirection, CONFIG.walkTurnAssist);

	const stepIndex = math.floor(walkCycle * 2);
	if (stepIndex !== lastStepIndex) {
		lastStepIndex = stepIndex;

		const kickSide = stepIndex % 2 === 0 ? 1 : -1;
		rootPart.AssemblyAngularVelocity = rootPart.AssemblyAngularVelocity.add(
			new Vector3(CONFIG.walkStepAngularKick * 0.5 * kickSide, CONFIG.walkStepAngularKick * 0.18, -CONFIG.walkStepAngularKick * kickSide),
		);

		const side = rootPart.CFrame.RightVector.mul(CONFIG.walkSideDrift * kickSide * limpIntensity);
		rootPart.AssemblyLinearVelocity = rootPart.AssemblyLinearVelocity.add(new Vector3(side.X, 0, side.Z));
	}

	applyLimpWalkPose(rawStep, pulse, limpIntensity);
}

function applyLimpWalkPose(rawStep: number, pulse: number, amount: number) {
	if (!humanoid) return;

	const step = rawStep;
	const stepAbs = math.abs(step);
	const stepSnap = math.pow(stepAbs, 1.45);
	const stepSide = step >= 0 ? 1 : -1;
	const fastTiny = math.sin(walkCycle * math.pi * 4);
	const fastTinyAbs = math.abs(fastTiny);

	const bodyForward = math.rad(27) * amount;
	const bodyBackRightLeft = math.rad(13) * amount * stepSide;
	const bodyRoll = math.rad(8) * amount * stepSide * (0.45 + stepSnap * 0.55);
	const bodyNod = math.rad(3) * amount * fastTiny;

	const waistCounterTwist = -bodyBackRightLeft * 0.72;
	const shoulderTwist = bodyBackRightLeft * 0.88;

	const legSpreadX = 0.2 * amount;
	const legSpreadAngle = math.rad(28) * amount;
	const tinyStride = math.rad(15) * amount * step;
	const ankleLikeBounce = math.rad(4) * amount * fastTiny;
	const kneeLeft = math.rad(8) * amount * math.max(step, 0) + math.rad(4) * amount * fastTinyAbs;
	const kneeRight = math.rad(8) * amount * math.max(-step, 0) + math.rad(4) * amount * fastTinyAbs;

	const armBack = math.rad(62) * amount;
	const armSideBack = math.rad(26) * amount;
	const armLock = math.rad(11) * amount;
	const armTinyShake = math.rad(3) * amount * fastTiny;

	if (rootMotor) {
		rootMotor.Transform = CFrame.Angles(bodyForward + bodyNod, bodyBackRightLeft, bodyRoll);
	}

	if (waistMotor) {
		waistMotor.Transform = CFrame.Angles(
			math.rad(13) * amount + bodyNod * 0.45,
			waistCounterTwist,
			-bodyRoll * 0.48,
		);
	}

	if (neckMotor) {
		neckMotor.Transform = CFrame.Angles(
			-math.rad(11) * amount - bodyNod * 0.25,
			-bodyBackRightLeft * 0.35,
			bodyRoll * 0.22,
		);
	}

	if (leftHipMotor) {
		leftHipMotor.Transform = new CFrame(-legSpreadX, 0, 0).mul(
			CFrame.Angles(
				-tinyStride - ankleLikeBounce,
				0,
				legSpreadAngle + math.rad(4) * amount * stepSnap,
			),
		);
	}

	if (rightHipMotor) {
		rightHipMotor.Transform = new CFrame(legSpreadX, 0, 0).mul(
			CFrame.Angles(
				tinyStride + ankleLikeBounce,
				0,
				-legSpreadAngle - math.rad(4) * amount * stepSnap,
			),
		);
	}

	if (leftKneeMotor) {
		leftKneeMotor.Transform = CFrame.Angles(-kneeLeft, 0, 0);
	}

	if (rightKneeMotor) {
		rightKneeMotor.Transform = CFrame.Angles(kneeRight, 0, 0);
	}

	if (leftShoulderMotor) {
		leftShoulderMotor.Transform = new CFrame(-0.08 * amount, 0, 0.15 * amount).mul(
			CFrame.Angles(
				armBack + armTinyShake,
				-armSideBack - shoulderTwist * 0.35,
				armLock + shoulderTwist * 0.18,
			),
		);
	}

	if (rightShoulderMotor) {
		rightShoulderMotor.Transform = new CFrame(0.08 * amount, 0, 0.15 * amount).mul(
			CFrame.Angles(
				armBack - armTinyShake,
				armSideBack - shoulderTwist * 0.35,
				-armLock + shoulderTwist * 0.18,
			),
		);
	}

	if (leftElbowMotor) {
		leftElbowMotor.Transform = CFrame.Angles(math.rad(20) * amount, 0, 0);
	}

	if (rightElbowMotor) {
		rightElbowMotor.Transform = CFrame.Angles(math.rad(20) * amount, 0, 0);
	}

	humanoid.HipHeight = originalHipHeight - CONFIG.walkHipDrop * amount * (0.35 + stepSnap * 0.65);
}

function updateAirControl(dt: number) {
	if (!rootPart) return;
	if (state !== "Airborne") return;

	const input = getKeyboardDirection();
	if (!input) return;

	const current = rootPart.AssemblyLinearVelocity;
	const horizontal = new Vector3(current.X, 0, current.Z);
	const desired = input.mul(CONFIG.airControlMax);
	const corrected = horizontal.Lerp(desired, math.clamp(CONFIG.airControl * dt, 0, 0.05));

	rootPart.AssemblyLinearVelocity = new Vector3(corrected.X, current.Y, corrected.Z);
}

function resetStreakIfIdle() {
	if (hopStreak <= 0) return;
	if (isCharging || pendingHop) return;
	if (now() - lastHopTime < CONFIG.streakResetSeconds) return;

	hopStreak = 0;
	updateStreakUi();
}

function cameraKick(power: number) {
	cameraKickPower = power;
	cameraKickUntil = now() + 0.18;
}

function updateCamera(dt: number) {
	const camera = Workspace.CurrentCamera;
	if (!camera || !humanoid) return;

	let targetFov = originalFov;
	let targetOffset = new Vector3(0, 0, 0);

	if (isCharging) {
		const alpha = smoothStep(getChargeAlpha());
		targetFov -= CONFIG.cameraChargeFovPull * alpha;
		targetOffset = targetOffset.add(new Vector3(math.sin(now() * 24) * 0.05 * alpha, -0.05 * alpha, 0));
	}

	if (now() < cameraKickUntil) {
		const remain = clamp01((cameraKickUntil - now()) / 0.18);
		targetFov += CONFIG.cameraHopFovKick * cameraKickPower * remain;

		const shake = CONFIG.cameraLandingShake * cameraKickPower * remain;
		targetOffset = targetOffset.add(new Vector3(math.sin(now() * 86) * shake, math.cos(now() * 77) * shake, 0));
	}

	camera.FieldOfView = lerpNumber(camera.FieldOfView, targetFov, math.clamp(dt * 12, 0, 1));
	humanoid.CameraOffset = humanoid.CameraOffset.Lerp(targetOffset, math.clamp(dt * 14, 0, 1));
}

function boot() {
	createUi();

	if (player.Character) {
		setupCharacter(player.Character);
	}

	player.CharacterAdded.Connect((model) => {
		setupCharacter(model);
	});
}

UserInputService.InputBegan.Connect((input, gameProcessed) => {
	if (gameProcessed) return;
	if (input.KeyCode === Enum.KeyCode.Space) startCharge();
});

UserInputService.InputEnded.Connect((input) => {
	if (input.KeyCode === Enum.KeyCode.Space) releaseCharge();
});

function updateOneLeg(dt: number) {
	if (rootPart) {
		lastVerticalVelocity = rootPart.AssemblyLinearVelocity.Y;
	}

	const grounded = isGrounded();
	if (grounded && !lastGrounded && state === "Airborne") {
		handleLanding();
	}
	lastGrounded = grounded;

	if (isCharging) {
		applyChargePose(getChargeAlpha());
	} else {
		updateLimpWalk(dt);
	}

	updateAirControl(dt);
	updateCamera(dt);
	resetStreakIfIdle();
	updateHopButton(isCharging ? getChargeAlpha() : 0);
}

RunService.BindToRenderStep("OneLegVisiblePoseAfterAnimation", Enum.RenderPriority.Character.Value + 10, updateOneLeg);

boot();

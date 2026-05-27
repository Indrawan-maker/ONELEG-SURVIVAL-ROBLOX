const Players = game.GetService("Players");

function setupCharacter(character: Model) {
	const humanoid = character.WaitForChild("Humanoid") as Humanoid;

	humanoid.WalkSpeed = 6.2;
	humanoid.UseJumpPower = true;
	humanoid.JumpPower = 0;
	humanoid.JumpHeight = 0;
}

Players.PlayerAdded.Connect((player) => {
	player.CharacterAdded.Connect((character) => {
		setupCharacter(character);
	});
});

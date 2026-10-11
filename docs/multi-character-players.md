# Multiple characters per player

In the lobby's game settings, leave **One character each** on for the usual one-sheet-per-player table. Turn it off and choose **All active** to field several independently controlled characters per player. **One active** keeps the other owned sheets on the bench; change the fielded character between encounters.

Choose a character by name in the lobby, or with **Play as** on its card in the party panel at the table. Selection is saved with campaign membership and survives reconnects. Every owned sheet remains in the party list; open its sheet there to inspect inventory and equipment. Selecting a sheet does not change its owner.

Outside initiative, actions come from the selected character. During initiative, actions and the combat hand come from the owned character whose turn is active, even when another sheet is selected for inspection. The Hand's header and the message box name that character. Every fielded sheet has its own initiative entry, token, position, HP and resources. AI companions and sheet-bound pets keep their existing control rules.

Adding the same library character again reuses its existing campaign sheet and preserves its progress. Adding a different character creates a separate owned sheet when the table permits it, and that character takes your seat as you add it, unless the table plays **One active** and a fight is on: then it waits on the bench until the fight ends. The dice tray, a sheet's hit dice, its Save to library button and its between-adventures lines all belong to the sheet on screen, so a character you are only inspecting is never mistaken for the one you play. The campaign owner may create a sheet for an existing member through the sheet API's optional playerUserId; another player's private library remains private.

## Implementation

Ownership is CharacterSheet.userId. Selection is campaign_members.active_character_id. Initiative identifies a character by sheet ID, and player messages retain characterId. No schema migration is required. The actions API accepts an optional characterId, verifies ownership and the initiative actor, and retains the selected/initiative fallback for older clients. Stream updates upsert and delete by sheet ID.

Native desktop/mobile renderers must be rebuilt from this server source; an older bundled renderer cannot gain the switcher from a server update alone.

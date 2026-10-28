/**
 * The tools a plugin's window takes (PLUGIN-4): one track's rack, with no timeline, transport, audio
 * engine or version history, and no other tracks. While a plugin is the window driven, the server
 * hides every other tool, and shows them again when the app is driven; MCP clients hear the list
 * change. MIDI devices aren't here: the plugin doesn't play them yet (PLUGIN-3.8).
 */
export const PLUGIN_TOOLS: ReadonlySet<string> = new Set([
  // The track and its instrument.
  "list_tracks",
  "set_instrument",
  "list_parameters",
  "set_parameter",
  // Its effects.
  "list_effects",
  "add_effect",
  "remove_effect",
  "move_effect",
  "bypass_effect",
  "list_effect_parameters",
  "set_effect_parameter",
  // Devices of your own.
  "describe_device_format",
  "create_instrument",
  "create_effect",
  "update_instrument",
  "update_effect",
  "get_custom_device",
  "list_custom_devices",
  "remove_custom_device",
  // The library, and the samples a sampler can play.
  "list_patches",
  "get_patch",
  "save_patch",
  "list_samples",
]);

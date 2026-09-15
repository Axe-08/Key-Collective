export const UPSERT_MODEL_SQL = `
INSERT INTO model_registry (
  id, provider, logical_aliases, context_window, max_output_tokens,
  input_cost_per_mtok_micro, output_cost_per_mtok_micro, cache_read_cost_per_mtok_micro,
  supports_tools, supports_vision, supports_json_schema,
  deprecated_at, sunset_at, is_active, last_synced_at
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
ON CONFLICT(id) DO UPDATE SET
  provider = excluded.provider,
  logical_aliases = excluded.logical_aliases,
  context_window = excluded.context_window,
  max_output_tokens = excluded.max_output_tokens,
  input_cost_per_mtok_micro = excluded.input_cost_per_mtok_micro,
  output_cost_per_mtok_micro = excluded.output_cost_per_mtok_micro,
  cache_read_cost_per_mtok_micro = excluded.cache_read_cost_per_mtok_micro,
  supports_tools = excluded.supports_tools,
  supports_vision = excluded.supports_vision,
  supports_json_schema = excluded.supports_json_schema,
  deprecated_at = excluded.deprecated_at,
  sunset_at = excluded.sunset_at,
  is_active = excluded.is_active,
  last_synced_at = excluded.last_synced_at;
`;

export const INSERT_MODEL_SQL = `
INSERT INTO model_registry (
  id, provider, logical_aliases, context_window, max_output_tokens,
  input_cost_per_mtok_micro, output_cost_per_mtok_micro, cache_read_cost_per_mtok_micro,
  supports_tools, supports_vision, supports_json_schema,
  deprecated_at, sunset_at, is_active, last_synced_at
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
`;

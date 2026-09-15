/**
 * @file auditor.ts
 * Capability auditing against model definitions.
 */

import { ModelDef } from "../../types/models";
import { CapabilityRequirements, CapabilityCheckResult } from "./types";

/**
 * Audits a model definition against given requirements, returning pass/fail and missing capabilities.
 */
export function checkCapabilities(
  model: ModelDef<bigint>,
  requirements: CapabilityRequirements
): CapabilityCheckResult {
  const missingCapabilities: string[] = [];
  const reasons: string[] = [];

  const onlyActive = requirements.onlyActive ?? true;
  if (onlyActive && !model.isActive) {
    missingCapabilities.push("active");
    reasons.push(`Model '${model.id}' is inactive or deprecated`);
  }

  if (requirements.requiresTools && !model.supportsTools) {
    missingCapabilities.push("tools");
    reasons.push(`Model '${model.id}' does not support tool/function calling`);
  }

  if (requirements.requiresVision && !model.supportsVision) {
    missingCapabilities.push("vision");
    reasons.push(`Model '${model.id}' does not support multimodal vision inputs`);
  }

  if (requirements.requiresJsonSchema && !model.supportsJsonSchema) {
    missingCapabilities.push("json_schema");
    reasons.push(`Model '${model.id}' does not support structured JSON schema outputs`);
  }

  if (
    requirements.minContextLength !== undefined &&
    requirements.minContextLength > 0
    && model.contextWindow < requirements.minContextLength
  ) {
    missingCapabilities.push("context_length");
    reasons.push(
      `Model '${model.id}' context window (${model.contextWindow}) is smaller than required context length (${requirements.minContextLength})`
    );
  }

  if (
    requirements.maxOutputTokens !== undefined &&
    requirements.maxOutputTokens > 0
    && model.maxOutputTokens < requirements.maxOutputTokens
  ) {
    missingCapabilities.push("max_output_tokens");
    reasons.push(
      `Model '${model.id}' max output limit (${model.maxOutputTokens}) is smaller than requested output tokens (${requirements.maxOutputTokens})`
    );
  }

  if (
    requirements.provider !== undefined &&
    requirements.provider.trim().length > 0 &&
    model.provider.toLowerCase().trim() !== requirements.provider.toLowerCase().trim()
  ) {
    missingCapabilities.push("provider");
    reasons.push(
      `Model '${model.id}' provider '${model.provider}' does not match requested provider '${requirements.provider}'`
    );
  }

  if (
    requirements.maxCostPerMTokMicro !== undefined &&
    model.inputCostPerMTokMicro > requirements.maxCostPerMTokMicro
  ) {
    missingCapabilities.push("cost_limit");
    reasons.push(
      `Model '${model.id}' input cost (${model.inputCostPerMTokMicro} µ$) exceeds max allowed cost (${requirements.maxCostPerMTokMicro} µ$)`
    );
  }

  return {
    isCapable: missingCapabilities.length === 0,
    modelId: model.id,
    missingCapabilities,
    reasons,
  };
}

/**
 * Fast boolean check whether a model satisfies all requirements.
 */
export function isCapable(
  model: ModelDef<bigint>,
  requirements: CapabilityRequirements
): boolean {
  return checkCapabilities(model, requirements).isCapable;
}

/**
 * Converts a requirements object into a readable array of requirement tags.
 */
export function getRequiredCapabilityNames(requirements: CapabilityRequirements): string[] {
  const caps: string[] = [];
  if (requirements.requiresTools) caps.push("tools");
  if (requirements.requiresVision) caps.push("vision");
  if (requirements.requiresJsonSchema) caps.push("json_schema");
  if (requirements.requiresStreaming) caps.push("streaming");
  if (
    requirements.minContextLength !== undefined &&
    requirements.minContextLength > 0
  ) {
    caps.push(`context_length>=${requirements.minContextLength}`);
  }
  if (
    requirements.maxOutputTokens !== undefined &&
    requirements.maxOutputTokens > 0
  ) {
    caps.push(`max_output_tokens>=${requirements.maxOutputTokens}`);
  }
  if (requirements.provider) {
    caps.push(`provider=${requirements.provider}`);
  }
  if (requirements.maxCostPerMTokMicro !== undefined) {
    caps.push(`cost<=${requirements.maxCostPerMTokMicro}`);
  }
  return caps;
}

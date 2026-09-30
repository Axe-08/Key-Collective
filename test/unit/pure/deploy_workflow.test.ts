import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('deploy-prod.yml D1 backup step', () => {
  const workflowPath = join(__dirname, '../../../.github/workflows/deploy-prod.yml');
  const content = readFileSync(workflowPath, 'utf-8');
  const lines = content.split('\n');

  const exportLineIndex = lines.findIndex((l) => l.includes('wrangler d1 export'));
  const migrationsApplyLineIndex = lines.findIndex(
    (l) => l.includes('wrangler d1 migrations apply') && l.includes('--remote')
  );
  const uploadArtifactLineIndex = lines.findIndex((l) => l.includes('actions/upload-artifact'));
  const retentionLineIndex = lines.findIndex((l) => l.includes('retention-days: 30'));

  it('has both the D1 export step and the migrations-apply step', () => {
    expect(exportLineIndex).toBeGreaterThan(-1);
    expect(migrationsApplyLineIndex).toBeGreaterThan(-1);
  });

  it('runs the D1 export step before the migrations-apply step', () => {
    expect(exportLineIndex).toBeLessThan(migrationsApplyLineIndex);
  });

  it('uploads the backup with actions/upload-artifact and 30 day retention, between export and migrations-apply', () => {
    expect(uploadArtifactLineIndex).toBeGreaterThan(-1);
    expect(retentionLineIndex).toBeGreaterThan(-1);
    expect(uploadArtifactLineIndex).toBeGreaterThan(exportLineIndex);
    expect(uploadArtifactLineIndex).toBeLessThan(migrationsApplyLineIndex);
    expect(retentionLineIndex).toBeGreaterThan(exportLineIndex);
    expect(retentionLineIndex).toBeLessThan(migrationsApplyLineIndex);
  });
});

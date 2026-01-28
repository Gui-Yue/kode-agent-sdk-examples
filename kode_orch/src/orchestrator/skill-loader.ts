import { readdir, readFile } from 'node:fs/promises';
import { join, basename, dirname } from 'node:path';
import { logger } from '../utils/logger.js';

export interface SkillMeta {
  name: string;       // directory name, e.g. 'pdf', 'code-write'
  category: string;   // parent directory, e.g. 'office', 'coding'
  path: string;       // full path to SKILL.md
  dirPath: string;    // skill directory path
  summary: string;    // first 200 chars of SKILL.md
}

export class SkillLoader {
  private skills: SkillMeta[] = [];

  async loadIndex(skillsDir: string): Promise<void> {
    this.skills = [];
    try {
      const categories = await readdir(skillsDir, { withFileTypes: true });
      for (const cat of categories) {
        if (!cat.isDirectory()) continue;
        const catPath = join(skillsDir, cat.name);
        const skillDirs = await readdir(catPath, { withFileTypes: true });
        for (const sd of skillDirs) {
          if (!sd.isDirectory()) continue;
          const skillDir = join(catPath, sd.name);
          const skillFile = join(skillDir, 'SKILL.md');
          try {
            const content = await readFile(skillFile, 'utf-8');
            const summary = content.replace(/^#.*\n/, '').trim().slice(0, 200);
            this.skills.push({
              name: sd.name,
              category: cat.name,
              path: skillFile,
              dirPath: skillDir,
              summary,
            });
          } catch {
            // No SKILL.md in this directory, skip
          }
        }
      }
      logger.info('skill-loader', `Indexed ${this.skills.length} skills from ${skillsDir}`);
    } catch {
      logger.warn('skill-loader', `Skills directory not found: ${skillsDir}`);
    }
  }

  getSummary(): string {
    if (this.skills.length === 0) return '(暂无 Skill)';
    return this.skills
      .map((s) => `- [${s.category}/${s.name}] ${s.summary}`)
      .join('\n');
  }

  getSummaryByCategory(): Record<string, SkillMeta[]> {
    const result: Record<string, SkillMeta[]> = {};
    for (const s of this.skills) {
      (result[s.category] ??= []).push(s);
    }
    return result;
  }

  /**
   * Find skill by name (supports exact match or partial/suffix match)
   * e.g. 'web-artifacts-builder' will match 'anthropics-skills-web-artifacts-builder'
   */
  private findSkill(name: string): SkillMeta | undefined {
    // Try exact match first
    let skill = this.skills.find((s) => s.name === name);
    if (skill) return skill;

    // Try suffix match (e.g. 'web-artifacts-builder' matches 'xxx-web-artifacts-builder')
    skill = this.skills.find((s) => s.name.endsWith('-' + name) || s.name.endsWith(name));
    if (skill) return skill;

    // Try contains match
    skill = this.skills.find((s) => s.name.includes(name));
    return skill;
  }

  async loadFull(name: string): Promise<string> {
    const skill = this.findSkill(name);
    if (!skill) throw new Error(`Skill not found: ${name}`);
    return readFile(skill.path, 'utf-8');
  }

  async loadResource(name: string, relativePath: string): Promise<string> {
    const skill = this.findSkill(name);
    if (!skill) throw new Error(`Skill not found: ${name}`);
    return readFile(join(skill.dirPath, relativePath), 'utf-8');
  }

  /**
   * Get skill metadata by name (supports fuzzy matching)
   */
  getSkillMeta(name: string): SkillMeta | undefined {
    return this.findSkill(name);
  }

  getAll(): SkillMeta[] {
    return [...this.skills];
  }
}

import { AgentTemplateRegistry } from '@shareai-lab/kode-sdk';
import { researchTemplate } from './research.js';
import { analystTemplate } from './analyst.js';
import { executorTemplate } from './executor.js';
import { reviewerTemplate } from './reviewer.js';
import { testerTemplate } from './tester.js';

export function registerAllTemplates(registry: AgentTemplateRegistry): void {
  registry.register(researchTemplate);
  registry.register(analystTemplate);
  registry.register(executorTemplate);
  registry.register(reviewerTemplate);
  registry.register(testerTemplate);
}

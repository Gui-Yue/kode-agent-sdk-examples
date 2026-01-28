import { logger } from '../utils/logger.js';

export interface PendingApproval {
  taskId: string;
  permissionId: string;
  toolName: string;
  inputPreview: unknown;
  description: string;
  createdAt: number;
  respond: (decision: 'allow' | 'deny', opts?: { note?: string }) => Promise<void>;
}

export type PendingApprovalInfo = Omit<PendingApproval, 'respond'>;

export class ApprovalManager {
  private pending = new Map<string, PendingApproval>();

  add(approval: PendingApproval): void {
    this.pending.set(approval.permissionId, approval);
    logger.info('approval', 'New approval request', {
      permissionId: approval.permissionId,
      toolName: approval.toolName,
      taskId: approval.taskId,
    });
  }

  async decide(permissionId: string, decision: 'allow' | 'deny', note?: string): Promise<boolean> {
    const approval = this.pending.get(permissionId);
    if (!approval) return false;
    logger.info('approval', `Decision: ${decision}`, { permissionId, toolName: approval.toolName });
    await approval.respond(decision, note ? { note } : undefined);
    this.pending.delete(permissionId);
    return true;
  }

  getPending(): PendingApprovalInfo[] {
    return [...this.pending.values()].map(({ respond: _, ...rest }) => rest);
  }
}

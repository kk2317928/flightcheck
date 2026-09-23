export interface AdminOperationDependencies {
  flightSync: {
    run(input: {
      serviceDate: string;
      trigger: 'MANUAL';
    }): Promise<{ status: string }>;
  };
  statistics: {
    recalculate(input: {
      serviceDate: string;
      trigger: 'MANUAL';
    }): Promise<{ settlementStatus: string }>;
  };
  audit(input: {
    action: string;
    adminId: string;
    serviceDate: string;
    resultCode: string;
  }): Promise<void>;
}
export function createAdminOperations(
  dependencies: AdminOperationDependencies,
) {
  return {
    async sync(input: { adminId: string; serviceDate: string }) {
      const result = await dependencies.flightSync.run({
        serviceDate: input.serviceDate,
        trigger: 'MANUAL',
      });
      await dependencies.audit({
        action: 'ADMIN_FLIGHT_SYNC',
        ...input,
        resultCode: result.status,
      });
      return result;
    },
    async recalculate(input: { adminId: string; serviceDate: string }) {
      const result = await dependencies.statistics.recalculate({
        serviceDate: input.serviceDate,
        trigger: 'MANUAL',
      });
      await dependencies.audit({
        action: 'ADMIN_STATISTICS_RECALCULATE',
        ...input,
        resultCode: result.settlementStatus,
      });
      return result;
    },
  };
}

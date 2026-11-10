export interface CommercialGoalConfig {
  citasTarget: number;
  visitasTarget: number;
  ventasTarget: number;
  gestionesTarget: number;
}

export interface AdvisorGoalItem {
  citasTarget?: number;
  visitasTarget?: number;
  ventasTarget?: number;
  gestionesTarget?: number;
}

export interface AdvisorLeaderboardItem {
  advisorId: string;
  advisorName: string;
  email: string;
  photoUrl?: string | null;
  role: string;
  rank: number;
  score: number;
  targets: CommercialGoalConfig;
  actuals: {
    citas: number;
    visitas: number;
    ventas: number;
    gestiones: number;
  };
  percentages: {
    citasPct: number;
    visitasPct: number;
    ventasPct: number;
    gestionesPct: number;
    averageCompletionPct: number;
  };
  badges: string[];
}

export interface CommercialLeaderboardResponse {
  monthKey: string;
  monthLabel: string;
  defaultGoals: CommercialGoalConfig;
  advisorGoals: Record<string, AdvisorGoalItem>;
  companyTotals: {
    totalCitas: number;
    totalVisitas: number;
    totalVentas: number;
    totalGestiones: number;
    targetCitas: number;
    targetVisitas: number;
    targetVentas: number;
    targetGestiones: number;
    overallCompletionPct: number;
  };
  leaderboard: AdvisorLeaderboardItem[];
}

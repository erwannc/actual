import { queryOptions } from '@tanstack/react-query';

import { send } from 'loot-core/platform/client/connection';
import { q } from 'loot-core/shared/query';
import type {
  CustomReportEntity,
  DashboardPageEntity,
  DashboardWidgetEntity,
  FundsLocationMonthEntity,
} from 'loot-core/types/models';

import { aqlQuery } from '@desktop-client/queries/aqlQuery';

export const reportQueries = {
  all: () => ['reports'],
  lists: () => [...reportQueries.all(), 'lists'],
  list: () =>
    queryOptions<CustomReportEntity[]>({
      queryKey: [...reportQueries.lists()],
      queryFn: async () => {
        return await send('report/get');
      },
    }),
};

export const dashboardQueries = {
  all: () => ['dashboards'],
  lists: () => [...dashboardQueries.all(), 'lists'],
  listDashboardWidgets: <T extends DashboardWidgetEntity>() =>
    queryOptions<T[]>({
      queryKey: [...dashboardQueries.lists(), 'widgets'],
      queryFn: async () => {
        const { data }: { data: T[] } = await aqlQuery(
          q('dashboard').select('*'),
        );
        return data;
      },
    }),
  listDashboardPageWidgets: <T extends DashboardWidgetEntity>(
    dashboardPageId?: DashboardPageEntity['id'] | null,
  ) =>
    queryOptions<T[]>({
      ...dashboardQueries.listDashboardWidgets<T>(),
      select: widgets =>
        widgets.filter(w => w.dashboard_page_id === dashboardPageId),
      enabled: !!dashboardPageId,
    }),
  listDashboardPages: () =>
    queryOptions<DashboardPageEntity[]>({
      queryKey: [...dashboardQueries.lists(), 'pages'],
      queryFn: async () => {
        const { data }: { data: DashboardPageEntity[] } = await aqlQuery(
          q('dashboard_pages').select('*'),
        );
        return data.map(page => ({ ...page, name: page.name ?? '' }));
      },
    }),
};

export const fundsLocationQueries = {
  all: () => ['funds-location'],
  monthList: () => [...fundsLocationQueries.all(), 'months'],
  months: () =>
    queryOptions<string[]>({
      queryKey: fundsLocationQueries.monthList(),
      queryFn: async () => {
        return await send('api/budget-months');
      },
    }),
  month: (month?: string | null) =>
    queryOptions<FundsLocationMonthEntity>({
      queryKey: [...fundsLocationQueries.all(), 'month', month],
      queryFn: async () => {
        if (!month) {
          throw new Error('Month is required to load funds location data');
        }

        return await send('funds-location/get-month', { month });
      },
      enabled: !!month,
    }),
};

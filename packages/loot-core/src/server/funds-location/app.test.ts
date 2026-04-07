// @ts-strict-ignore
import * as connection from '../../platform/server/connection';
import * as fs from '../../platform/server/fs';
import * as db from '../db';
import { handlers } from '../main';
import {
  disableGlobalMutations,
  enableGlobalMutations,
  runHandler,
  runMutator,
} from '../mutators';
import * as sheet from '../sheet';

vi.mock('../post');

const TEST_BUDGET_ID = 'test-budget';
const TEST_BUDGET_NAME = 'default-budget-template';
const MONTH = '2019-02';

const CHECKING_ACCOUNT_ID = '42c1c158-4869-42f1-b48f-873d6b5b1dbd';
const FOOD_CATEGORY_ID = '541836f1-e756-4473-a5d0-6c1d3f06c7fa';
const BILLS_CATEGORY_ID = 'd4b0f075-3343-4408-91ed-fae94f74e5bf';
const SAVINGS_CATEGORY_ID = '6bbd8472-25d4-4cee-8a11-5bd9f7e83d61';

const POSITIVE_ACCOUNT_ID = 'funds-location-positive-account';
const ZERO_ACCOUNT_ID = 'funds-location-zero-account';
const NEGATIVE_ACCOUNT_ID = 'funds-location-negative-account';

beforeEach(async () => {
  await global.emptyDatabase()();
  disableGlobalMutations();
});

afterEach(async () => {
  await runHandler(handlers['close-budget']);
  connection.resetEvents();
  enableGlobalMutations();
  global.currentMonth = null;

  fs._setDocumentDir(null);
  const budgetPath = fs.join(
    __dirname,
    '../../mocks/files/budgets',
    TEST_BUDGET_ID,
  );

  if (await fs.exists(budgetPath)) {
    await fs.removeDirRecursively(budgetPath);
  }
});

async function createTestBudget(name: string) {
  const templatePath = fs.join(__dirname, '../../mocks/files', name);
  const budgetPath = fs.join(
    __dirname,
    '../../mocks/files/budgets',
    TEST_BUDGET_ID,
  );

  if (await fs.exists(budgetPath)) {
    await fs.removeDirRecursively(budgetPath);
  }

  fs._setDocumentDir(fs.join(budgetPath, '..'));

  await fs.mkdir(budgetPath);
  await fs.copyFile(
    fs.join(templatePath, 'metadata.json'),
    fs.join(budgetPath, 'metadata.json'),
  );
  await fs.copyFile(
    fs.join(templatePath, 'db.sqlite'),
    fs.join(budgetPath, 'db.sqlite'),
  );
}

async function waitForSpreadsheet() {
  await new Promise<void>(resolve => {
    sheet.get().onFinish(() => resolve());
  });
}

async function loadTestBudget() {
  await createTestBudget(TEST_BUDGET_NAME);
  global.currentMonth = MONTH;

  const { error } = await runHandler(handlers['load-budget'], {
    id: TEST_BUDGET_ID,
  });

  expect(error).toBe(undefined);
  await waitForSpreadsheet();
  global.stepForwardInTime(2_000_000_000_000);
}

async function setupFundsLocationScenario() {
  await loadTestBudget();

  await runMutator(async () => {
    await db.insertAccount({
      id: POSITIVE_ACCOUNT_ID,
      name: 'Savings Buffer',
    });
    await db.insertAccount({
      id: ZERO_ACCOUNT_ID,
      name: 'Petty Cash',
    });
    await db.insertAccount({
      id: NEGATIVE_ACCOUNT_ID,
      name: 'Credit Card',
    });

    await db.insertTransaction({
      id: 'funds-location-positive-transaction',
      account: POSITIVE_ACCOUNT_ID,
      amount: 30000,
      date: '2019-02-10',
    });
    await db.insertTransaction({
      id: 'funds-location-negative-transaction',
      account: NEGATIVE_ACCOUNT_ID,
      amount: -10000,
      date: '2019-02-12',
    });
    await db.insertTransaction({
      id: 'funds-location-late-checking-transaction',
      account: CHECKING_ACCOUNT_ID,
      amount: 25000,
      date: '2019-03-05',
    });
  });

  await runHandler(handlers['api/budget-set-amount'], {
    month: MONTH,
    categoryId: FOOD_CATEGORY_ID,
    amount: 40000,
  });
  await runHandler(handlers['api/budget-set-amount'], {
    month: MONTH,
    categoryId: SAVINGS_CATEGORY_ID,
    amount: 50000,
  });

  await waitForSpreadsheet();
}

describe('funds location app', () => {
  test('load-budget migrates the funds location table without losing budget data', async () => {
    await loadTestBudget();

    const table = await db.first<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'funds_location_allocations'",
    );
    const accountCount = await db.first<{ count: number }>(
      'SELECT COUNT(*) AS count FROM accounts WHERE tombstone = 0',
    );
    const months = await runHandler(handlers['api/budget-months']);

    expect(table?.name).toBe('funds_location_allocations');
    expect(accountCount?.count).toBeGreaterThan(0);
    expect(months).toContain(MONTH);
  });

  test('get-month uses month-end balances and only exposes positive categories and editable accounts', async () => {
    await setupFundsLocationScenario();

    const result = await runHandler(handlers['funds-location/get-month'], {
      month: MONTH,
    });

    expect(result.supported).toBe(true);
    expect(
      result.categories.map(category => ({
        id: category.id,
        name: category.name,
        balance: category.balance,
      })),
    ).toEqual([
      { id: FOOD_CATEGORY_ID, name: 'Food', balance: 40000 },
      { id: SAVINGS_CATEGORY_ID, name: 'Savings', balance: 50000 },
    ]);
    expect(result.categories.map(category => category.id)).not.toContain(
      BILLS_CATEGORY_ID,
    );

    expect(
      result.editableAccounts.map(account => ({
        id: account.id,
        name: account.name,
        balance: account.balance,
      })),
    ).toEqual([
      { id: CHECKING_ACCOUNT_ID, name: 'Checking', balance: 100000 },
      { id: POSITIVE_ACCOUNT_ID, name: 'Savings Buffer', balance: 30000 },
    ]);
    expect(
      result.readOnlyAccounts
        .map(account => ({
          id: account.id,
          name: account.name,
          balance: account.balance,
        }))
        .sort((left, right) => left.name.localeCompare(right.name)),
    ).toEqual([
      { id: NEGATIVE_ACCOUNT_ID, name: 'Credit Card', balance: -10000 },
      { id: ZERO_ACCOUNT_ID, name: 'Petty Cash', balance: 0 },
    ]);
  });

  test('save-month replaces the entire month snapshot', async () => {
    await setupFundsLocationScenario();

    await runHandler(handlers['funds-location/save-month'], {
      month: MONTH,
      allocations: [
        {
          categoryId: FOOD_CATEGORY_ID,
          accountId: CHECKING_ACCOUNT_ID,
          amount: 10000,
        },
        {
          categoryId: FOOD_CATEGORY_ID,
          accountId: POSITIVE_ACCOUNT_ID,
          amount: 5000,
        },
        {
          categoryId: SAVINGS_CATEGORY_ID,
          accountId: CHECKING_ACCOUNT_ID,
          amount: 20000,
        },
      ],
    });

    const updated = await runHandler(handlers['funds-location/save-month'], {
      month: MONTH,
      allocations: [
        {
          categoryId: FOOD_CATEGORY_ID,
          accountId: CHECKING_ACCOUNT_ID,
          amount: 9000,
        },
        {
          categoryId: FOOD_CATEGORY_ID,
          accountId: CHECKING_ACCOUNT_ID,
          amount: 6000,
        },
      ],
    });

    const rows = await db.all<{
      month: string;
      category_id: string;
      account_id: string;
      amount: number;
    }>(
      `SELECT month, category_id, account_id, amount
       FROM funds_location_allocations
       WHERE tombstone = 0
       ORDER BY category_id, account_id`,
    );

    expect(rows).toEqual([
      {
        month: MONTH,
        category_id: FOOD_CATEGORY_ID,
        account_id: CHECKING_ACCOUNT_ID,
        amount: 15000,
      },
    ]);
    expect(
      updated.allocations.map(allocation => ({
        category_id: allocation.category_id,
        account_id: allocation.account_id,
        amount: allocation.amount,
      })),
    ).toEqual([
      {
        category_id: FOOD_CATEGORY_ID,
        account_id: CHECKING_ACCOUNT_ID,
        amount: 15000,
      },
    ]);
  });

  test('save-month allows partial and overallocated states', async () => {
    await setupFundsLocationScenario();

    const saved = await runHandler(handlers['funds-location/save-month'], {
      month: MONTH,
      allocations: [
        {
          categoryId: FOOD_CATEGORY_ID,
          accountId: CHECKING_ACCOUNT_ID,
          amount: 60000,
        },
        {
          categoryId: SAVINGS_CATEGORY_ID,
          accountId: POSITIVE_ACCOUNT_ID,
          amount: 10000,
        },
      ],
    });

    expect(saved.categories).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: FOOD_CATEGORY_ID,
          allocated: 60000,
          remainder: -20000,
          isOverallocated: true,
        }),
        expect.objectContaining({
          id: SAVINGS_CATEGORY_ID,
          allocated: 10000,
          remainder: 40000,
          isPartiallyAllocated: true,
        }),
      ]),
    );
  });

  test('save-month only accepts currently editable categories and accounts', async () => {
    await setupFundsLocationScenario();

    await expect(
      runHandler(handlers['funds-location/save-month'], {
        month: MONTH,
        allocations: [
          {
            categoryId: BILLS_CATEGORY_ID,
            accountId: CHECKING_ACCOUNT_ID,
            amount: 1000,
          },
        ],
      }),
    ).rejects.toThrow('Unknown funds location category');

    await expect(
      runHandler(handlers['funds-location/save-month'], {
        month: MONTH,
        allocations: [
          {
            categoryId: FOOD_CATEGORY_ID,
            accountId: NEGATIVE_ACCOUNT_ID,
            amount: 1000,
          },
        ],
      }),
    ).rejects.toThrow('Unknown funds location account');
  });
});

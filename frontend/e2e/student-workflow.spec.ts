import { expect, test } from '@playwright/test';

const fixture = {
  schemaVersion: '1.5.0',
  source: 'FFCS_OS_VTOP_EXTENSION',
  courses: [
    {
      courseCode: 'CSE1001', courseTitle: 'Foundations of Computing', credits: 4, courseType: 'Theory', courseStructure: '3-0-0',
      options: [
        { offeringId: 'cse-a', componentType: 'Theory', rawSlot: 'A11+A12', slots: ['A11', 'A12'], facultyName: 'Faculty A', venue: 'AB01-101', building: 'AB01', availableSeats: 0, totalSeats: 60 },
        { offeringId: 'cse-b', componentType: 'Theory', rawSlot: 'B11', slots: ['B11'], facultyName: 'Faculty B', venue: 'AB02-101', building: 'AB02', availableSeats: 20, totalSeats: 60 },
        { offeringId: 'cse-c', componentType: 'Theory', rawSlot: 'C11', slots: ['C11'], facultyName: 'Faculty C', venue: 'AB01-102', building: 'AB01', availableSeats: 15, totalSeats: 60 },
      ],
    },
    {
      courseCode: 'MAT1001', courseTitle: 'Calculus', credits: 3, courseType: 'Theory', courseStructure: '3-0-0',
      options: [
        { offeringId: 'mat-a', componentType: 'Theory', rawSlot: 'A11', slots: ['A11'], facultyName: 'Faculty D', venue: 'AB01-201', building: 'AB01', availableSeats: 12, totalSeats: 60 },
        { offeringId: 'mat-d', componentType: 'Theory', rawSlot: 'D11', slots: ['D11'], facultyName: 'Faculty E', venue: 'AB02-201', building: 'AB02', availableSeats: 10, totalSeats: 60 },
      ],
    },
  ],
};

test('student imports, generates, validates, saves, reloads, and prints a timetable using the real API', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/');
  await page.getByRole('button', { name: 'Import data' }).click();
  await page.getByPlaceholder(/schemaVersion/i).fill(JSON.stringify(fixture));
  await page.getByRole('button', { name: 'Import JSON' }).click();
  await expect(page.getByRole('heading', { name: 'Course workspace' })).toBeVisible();
  await expect(page.getByRole('status')).toContainText('2 courses imported and selected from pasted JSON');
  await expect(page.getByText('Foundations of Computing')).toBeVisible();

  await page.getByRole('button', { name: /Timetable builder/i }).click();
  await page.getByRole('button', { name: 'Show schedule options' }).click();
  await expect(page.getByRole('heading', { name: /\d+ schedule options/ })).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: 'Use this timetable' }).click();
  await expect(page.getByText('All selected offerings passed backend timetable validation.')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole('button', { name: 'Save timetable' })).toBeEnabled();

  await page.getByLabel('Schedule name').fill('Deployment browser timetable');
  await page.evaluate(() => { window.print = () => document.body.setAttribute('data-print-requested', 'true'); });
  await page.getByRole('button', { name: 'Export as PDF' }).click();
  await expect(page.locator('.print-root')).toHaveCount(1);
  await expect(page.locator('body')).toHaveAttribute('data-print-requested', 'true', { timeout: 30_000 });

  await page.getByRole('button', { name: 'Save timetable' }).click();
  await expect(page.getByText('Validated timetable saved.')).toBeVisible({ timeout: 30_000 });
  await page.reload();
  await page.getByRole('button', { name: /My timetables/i }).click();
  await expect(page.getByText('Deployment browser timetable')).toBeVisible({ timeout: 10_000 });
  await page.getByRole('button', { name: 'Delete Deployment browser timetable' }).click();
  await expect(page.getByText('No saved timetables yet')).toBeVisible();
});

test('handles empty imports and API errors in the real browser', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Import data' }).click();
  await page.getByPlaceholder(/schemaVersion/i).fill(JSON.stringify({ schemaVersion: '1.5.0', courses: [] }));
  await page.getByRole('button', { name: 'Import JSON' }).click();
  await expect(page.getByRole('status')).toContainText('0 courses imported and selected from pasted JSON');
  await expect(page.getByText('No courses to show')).toBeVisible();

  await page.route('**/api/parse', route => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'test API unavailable' }) }));
  await page.getByRole('button', { name: 'Import data' }).click();
  await page.getByPlaceholder(/schemaVersion/i).fill(JSON.stringify({ schemaVersion: '1.5.0', courses: [] }));
  await page.getByRole('button', { name: 'Import JSON' }).click();
  await expect(page.getByText('test API unavailable')).toBeVisible();
});

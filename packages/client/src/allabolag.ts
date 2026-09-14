import process from 'node:process';
import { z } from 'zod';
import { DataService, DataSource } from '@build-a-bot/core';
// import { companySchema, companyUrl } from './timo/company.js';
import { proxies } from './timo/proxies.js';
import { exercise } from './workflow.js';

const text = (description: string) => z.string().nullable().describe(description);
const amount = (description: string) => z.number().nullable().describe(description);

export const companySchema = z
  .object({
    company_name: z.string().describe('Registered legal company name, exactly as published'),
    org_number: z.string().describe('Swedish organisation number; durable company identity'),
    company_status: text('Registration/activity status as published'),
    industry_sni: z.array(z.object({ code: text('SNI code'), name: text('Industry label') })),
    municipality: text('Municipality / kommun'),
    county: text('County / län'),
    financial_year: text('Reporting period for the financial amounts and employee count'),
    currency: text('Currency for financial amounts'),
    revenue: amount('Revenue / omsättning; normalize to whole currency units, not thousands'),
    employees: amount('Reported employee count for the financial year'),
    result: amount('Published net result / årets resultat, in whole currency units'),
    ebitda: amount(
      'Published EBITDA in whole currency units; null when not available, do not substitute EBIT'
    ),
    website: text('Official company website'),
    management_board: z.array(
      z.object({ name: z.string(), role: text('Published management or board role') })
    ),
    parent_group: z
      .object({
        parent_name: text('Direct parent company'),
        parent_org_number: text('Direct parent organisation number'),
        group_name: text('Ultimate group / koncern name'),
      })
      .nullable(),
  })
  .describe(
    'Extract raw published company facts from the supplied Allabolag profile. Use null or empty arrays for unavailable fields; never invent or infer financial amounts or people.'
  );
export const companyUrl =
  'https://www.allabolag.se/foretag/volvo-personvagnar-aktiebolag/g%C3%B6teborg/elmotorer-generatorer/2JYQ0TTI5YE0U';

const service = new DataService({
  name: 'beta-allabolag',
  // proxies: proxies(),
  itemSchema: companySchema,
  // identity: { fields: [{ path: 'org_number', normalize: 'digits' }] },
  sources: [new DataSource({ url: companyUrl })],
  // sources: [new DataSource({ url: companyUrl, cache: { maxAgeMs: 7 * 24 * 60 * 60 * 1000 } })],
});

process.exit((await exercise(service, 1)) ? 0 : 1);

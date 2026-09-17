import process from 'node:process';
import { z } from 'zod';
import { DataService, DataSource } from '@build-a-bot/core';
import { createClientContext } from './timo/proxies.js';
import { exercise } from './workflow.js';

const text = (description: string) => z.string().nullable().describe(description);
export const jobSchema = z
  .object({
    source_url: z.string().describe('Supplied discovery or detail URL'),
    canonical_url: z
      .string()
      .describe('Canonical URL of this individual job, without tracking parameters'),
    external_job_id: text(
      'Durable ATS posting/requisition ID. Use with ATS and company for stable identity; never derive identity from mutable job text'
    ),
    title: z.string(),
    company: z.string(),
    location: text('All published job locations'),
    country: text('Published country'),
    description: text('Complete job description as normalized plain text'),
    published_at: text('Published timestamp in ISO format where available'),
    deadline_at: text('Application deadline in ISO format where available'),
    employment_type: text('Permanent, temporary, contract, internship, etc., as published'),
    duration: text('Contract duration, if published'),
    working_hours: text('Full-time/part-time or published hours'),
    work_model: text('Remote, hybrid, onsite, if explicitly published'),
    application_url: text('Direct URL of the application form'),
    requirements: z
      .array(z.string())
      .describe('Published job requirements; no inferred qualifications'),
    taxonomy: z
      .array(z.string())
      .describe('Published job categories, departments, seniority or skill tags'),
    ats_platform: text(
      'Identify the underlying ATS from page, scripts, forms or endpoint evidence'
    ),
    ats_evidence: z.array(z.string()).describe('Observed URLs or page markers identifying the ATS'),
    application_structure: z.object({
      status: z
        .enum(['complete', 'partial', 'unavailable'])
        .describe(
          'Complete only if the actual application form has been inspected; login/gating or inaccessible form means partial/unavailable'
        ),
      notes: text('Describe inaccessible, conditional, login-gated or multi-step portions'),
      cv_required: z.boolean().nullable(),
      cover_letter_required: z.boolean().nullable(),
      groups: z
        .array(
          z.object({
            label: z.string(),
            required: z.boolean(),
            rule: z.literal('oneOf'),
            fields: z.array(z.string()),
          })
        )
        .default([])
        .describe(
          'Observed alternative input groups, e.g. resume file OR manual text; infer rules only from inspected page evidence'
        ),
      fields: z
        .array(
          z.object({
            name: text('Stable HTML field name or ATS question ID'),
            label: z.string(),
            type: z.string().describe('text, email, textarea, select, radio, checkbox, file, etc.'),
            required: z
              .boolean()
              .nullable()
              .describe('Required only when supported by form metadata; null when unknown'),
            options: z.array(z.string()).describe('All observed dropdown/radio/checkbox choices'),
            accepted_file_types: z
              .array(z.string())
              .describe('Allowed upload extensions/MIME types, if published'),
          })
        )
        .describe('All visible application inputs and questions, including consent and uploads'),
    }),
  })
  .describe(
    'Extract each currently open job matching the supplied URL filters, following listing links to job details and inspecting application forms. Do not apply, submit, upload files, or create accounts. Preserve missing facts as null or empty arrays. Closed/removed listings yield no items only with positive evidence; throw on blocked/failed fetches instead of interpreting failure as removal. Validate discovered unique posting counts against published listing totals and throw on mismatch. Follow actual listing links or captured read-only JSON identifiers, including canonical /job/ links when supplied examples use /details/. A results container with no matching links is not evidence of an empty listing.'
  );

const jobUrls = {
  teamtailor: 'https://career.teamtailor.com/jobs?country=Sweden',
  greenhouse: 'https://job-boards.eu.greenhouse.io/mentimeter/jobs/4954100101',
  lever: 'https://jobs.lever.co/walkme?location=Stockholm',
  ashby: 'https://jobs.ashbyhq.com/neuralconcept/2a1e39ac-4135-411d-a63d-cd67f1679770',
  smartrecruiters: 'https://careers.smartrecruiters.com/SopraSteria1/se_ssg_sweden-stockholm',
  workday: 'https://vaderstad.wd3.myworkdayjobs.com/sv-SE/External_Careers',
};

const workdayUrls = [
  jobUrls.workday,
  'https://vaderstad.wd3.myworkdayjobs.com/sv-SE/External_Careers/details/Test-Engineer---Mechanical_JR101455',
  'https://vaderstad.wd3.myworkdayjobs.com/sv-SE/External_Careers/details/Buyer---Maternity-Leave-Coverage--12-14-Month-Contract_JR101454',
  'https://vaderstad.wd3.myworkdayjobs.com/sv-SE/External_Careers/details/Maintenance-Technician_JR101452',
];

let urls: string[] = [
  'https://career.teamtailor.com/jobs?country=Sweden',
  'https://job-boards.eu.greenhouse.io/mentimeter/jobs/4954100101',
  'https://jobs.lever.co/walkme?location=Stockholm',
  'https://jobs.ashbyhq.com/neuralconcept/2a1e39ac-4135-411d-a63d-cd67f1679770',
  'https://careers.smartrecruiters.com/SopraSteria1/se_ssg_sweden-stockholm',

  'https://vaderstad.wd3.myworkdayjobs.com/sv-SE/External_Careers',
  'https://vaderstad.wd3.myworkdayjobs.com/sv-SE/External_Careers/details/Test-Engineer---Mechanical_JR101455',
  'https://vaderstad.wd3.myworkdayjobs.com/sv-SE/External_Careers/details/Buyer---Maternity-Leave-Coverage--12-14-Month-Contract_JR101454',
  'https://vaderstad.wd3.myworkdayjobs.com/sv-SE/External_Careers/details/Maintenance-Technician_JR101452',
];

// const grep: string = process.argv.slice(2);
// if (grep) {
//   urls = urls.filter(it => it.toLowerCase().includes(grep));
// }
// for (const name of selected) {
//   if (!(name in jobUrls)) {
//     throw new Error(`Unknown ATS: ${name}`);
//   }
// }
// let ok = true;
// for (const [name, url] of Object.entries(jobUrls)) {
//   if (selected.length && !selected.includes(name)) {
//     continue;
//   }
// }

const service = new DataService({
  name: `beta-jobs`,
  context: await createClientContext(),
  itemSchema: jobSchema,
  identity: {
    fields: [
      { path: 'ats_platform', normalize: 'lowercase' },
      { path: 'canonical_url', normalize: 'url-tenant' },
      { path: 'external_job_id' },
    ],
  },
  sources: urls.map((url) => new DataSource({ url })),
});
const ok = await exercise(service, 1);
process.exit(ok ? 0 : 1);

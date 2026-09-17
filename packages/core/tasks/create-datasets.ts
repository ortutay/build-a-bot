import { createGlobalContext } from '../src/context/index.js';
import { DocumentLibrary } from '../src/documents/index.js';
import {
  createBasicIfNotExists,
  createRealEstateIfNotExists,
  upsertBasic,
  upsertRealEstate,
} from '../src/mastra/datasets/index.js';

const main = async () => {
  const context = await createGlobalContext({ documentLibrary: new DocumentLibrary() });
  try {
    const realEstateDataset = await createRealEstateIfNotExists(context.mastra);
    await upsertRealEstate(context.mastra, realEstateDataset);

    const basicDataset = await createBasicIfNotExists(context.mastra);
    await upsertBasic(context.mastra, basicDataset);
  } finally {
    await context.close();
  }
};

main().then(() => process.exit(0));

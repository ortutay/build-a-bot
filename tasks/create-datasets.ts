import {
  createBasicIfNotExists,
  createRealEstateIfNotExists,
  upsertBasic,
  upsertRealEstate,
} from '../src/mastra/datasets/index.js';

const main = async () => {
  const realEstateDataset = await createRealEstateIfNotExists();
  await upsertRealEstate(realEstateDataset);

  const basicDataset = await createBasicIfNotExists();
  await upsertBasic(basicDataset);
};

main().then(() => process.exit(0));

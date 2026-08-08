import "dotenv/config";
import { runAccess } from "./run.js";

// Edit this target freely while experimenting with the agent.
const target = {
  url: "https://uk.rubix.com/en/adhesive-tapes/c-50-15-20",
  prompt:
    "Scrape all tape products: EUR price, dimensions, and other standard details.",
};

runAccess(target)
  .then(({ plan, usage }) => {
    console.log("Output:", plan);
    console.log("Usage:", usage);
  })
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  });

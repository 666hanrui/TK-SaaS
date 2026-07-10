import { automationTaskCatalog, currentTaskBindings, getAutomationDefinition } from "../catalog/taskCatalog.js";

const byModule = Object.groupBy(automationTaskCatalog, ({ module }) => module);
const byRisk = Object.groupBy(automationTaskCatalog, ({ riskLevel }) => riskLevel);
const unresolvedBindings = Object.entries(currentTaskBindings)
  .flatMap(([taskKey, binding]) =>
    Object.entries(binding)
      .filter(([, definitionId]) => !getAutomationDefinition(definitionId))
      .map(([operation, definitionId]) => ({ taskKey, operation, definitionId })),
  );

const summary = {
  totalDefinitions: automationTaskCatalog.length,
  browserDefinitions: automationTaskCatalog.filter(({ executor }) => executor === "browser").length,
  internalDefinitions: automationTaskCatalog.filter(({ executor }) => executor === "internal").length,
  byModule: Object.fromEntries(Object.entries(byModule).map(([key, items]) => [key, items.length])),
  byRisk: Object.fromEntries(Object.entries(byRisk).map(([key, items]) => [key, items.length])),
  currentTaskBindings: Object.keys(currentTaskBindings).length,
  unresolvedBindings,
};

if (process.argv.includes("--json")) {
  console.log(JSON.stringify({ summary, definitions: automationTaskCatalog }, null, 2));
} else {
  console.table(summary.byModule);
  console.table(summary.byRisk);
  console.log(JSON.stringify(summary, null, 2));
}

if (unresolvedBindings.length > 0) process.exitCode = 1;

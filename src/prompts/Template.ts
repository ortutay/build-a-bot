const placeholderPattern = /(?<!\\)\{\{(.+?)\}\}/g;
const replacementPattern = /(\\)?\{\{(.+?)\}\}/g;

export class Template {
  readonly argumentList: string[];
  readonly template: string;

  constructor(argumentList: string[], template: string) {
    const placeholders = [...template.matchAll(placeholderPattern)].map((match) => match[1]);
    const argumentsSet = new Set(argumentList);
    const placeholdersSet = new Set(placeholders);

    if (
      placeholders.length === 0 ||
      argumentsSet.size !== argumentList.length ||
      argumentsSet.size !== placeholdersSet.size ||
      [...argumentsSet].some((argument) => !placeholdersSet.has(argument))
    ) {
      throw new Error('Template placeholders must exactly match the argumentList.');
    }

    this.argumentList = argumentList;
    this.template = template;
  }

  render(values: Record<string, string>): string {
    const names = Object.keys(values);
    if (
      names.length !== this.argumentList.length ||
      names.some((name) => !this.argumentList.includes(name))
    ) {
      throw new Error('Template render arguments must exactly match the argumentList.');
    }

    return this.template.replace(replacementPattern, (placeholder, escaped, name) =>
      escaped ? placeholder.slice(1) : values[name]
    );
  }
}

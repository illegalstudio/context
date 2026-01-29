import ora, { type Ora } from 'ora';

export class Spinner {
  private spinner: Ora;

  constructor(text: string = '') {
    this.spinner = ora({
      text,
      spinner: 'dots',
    });
  }

  start(text?: string): this {
    if (text) {
      this.spinner.text = text;
    }
    this.spinner.start();
    return this;
  }

  stop(): this {
    this.spinner.stop();
    return this;
  }

  succeed(text?: string): this {
    this.spinner.succeed(text);
    return this;
  }

  fail(text?: string): this {
    this.spinner.fail(text);
    return this;
  }

  warn(text?: string): this {
    this.spinner.warn(text);
    return this;
  }

  info(text?: string): this {
    this.spinner.info(text);
    return this;
  }

  text(text: string): this {
    this.spinner.text = text;
    return this;
  }

  // For progress reporting
  progress(current: number, total: number, item: string): this {
    const percent = Math.round((current / total) * 100);
    this.spinner.text = `[${current}/${total}] ${percent}% - ${item}`;
    return this;
  }
}

export function createSpinner(text: string = ''): Spinner {
  return new Spinner(text);
}

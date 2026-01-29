import chalk from 'chalk';

export const logger = {
  info: (message: string) => {
    console.log(chalk.blue('ℹ'), message);
  },

  success: (message: string) => {
    console.log(chalk.green('✓'), message);
  },

  warning: (message: string) => {
    console.log(chalk.yellow('⚠'), message);
  },

  error: (message: string) => {
    console.log(chalk.red('✗'), message);
  },

  dim: (message: string) => {
    console.log(chalk.dim(message));
  },

  bold: (message: string) => {
    console.log(chalk.bold(message));
  },

  header: (message: string) => {
    console.log();
    console.log(chalk.bold.underline(message));
    console.log();
  },

  list: (items: string[]) => {
    for (const item of items) {
      console.log(chalk.dim('  •'), item);
    }
  },

  table: (rows: string[][]) => {
    for (const row of rows) {
      console.log('  ' + row.join('  '));
    }
  },

  blank: () => {
    console.log();
  },
};

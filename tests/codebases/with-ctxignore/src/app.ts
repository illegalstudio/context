/**
 * Main application file - should be indexed
 */

import { Dependency } from '../vendor/dep.js';

export class App {
  private dep: Dependency;

  constructor() {
    this.dep = new Dependency();
  }

  run(): void {
    console.log('App running');
    this.dep.doSomething();
  }
}

const app = new App();
app.run();

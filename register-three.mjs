// register-three.mjs — registers test-loader.mjs for `node --import`.
import { register } from 'node:module';

register('./test-loader.mjs', import.meta.url);

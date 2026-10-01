import { app } from './app.js';
import { config } from './config.js';

app.listen(config.port, () => {
  console.log(`recupera-test-server in ascolto su http://localhost:${config.port}`);
});

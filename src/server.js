const { server } = require('./app');

const port = process.env.PORT || 3000;
// Bind explicitly to 0.0.0.0 for Render's port-binding checks
server.listen(port, '0.0.0.0', () => {
  console.log(`Server listening on port ${port}`);
});

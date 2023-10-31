const app = require('./app')

const server = app.listen(process.env.PORT, () => {
  console.log(`server is working at ${process.env.PORT}`)
})

<p align="center">
  <a href="http://nestjs.com/" target="blank"><img src="https://nestjs.com/img/logo-small.svg" width="120" alt="Nest Logo" /></a>
</p>

[circleci-image]: https://img.shields.io/circleci/build/github/nestjs/nest/master?token=abc123def456
[circleci-url]: https://circleci.com/gh/nestjs/nest

  <p align="center">A progressive <a href="http://nodejs.org" target="_blank">Node.js</a> framework for building efficient and scalable server-side applications.</p>
    <p align="center">
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/v/@nestjs/core.svg" alt="NPM Version" /></a>
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/l/@nestjs/core.svg" alt="Package License" /></a>
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/dm/@nestjs/common.svg" alt="NPM Downloads" /></a>
<a href="https://circleci.com/gh/nestjs/nest" target="_blank"><img src="https://img.shields.io/circleci/build/github/nestjs/nest/master" alt="CircleCI" /></a>
<a href="https://discord.gg/G7Qnnhy" target="_blank"><img src="https://img.shields.io/badge/discord-online-brightgreen.svg" alt="Discord"/></a>
<a href="https://opencollective.com/nest#backer" target="_blank"><img src="https://opencollective.com/nest/backers/badge.svg" alt="Backers on Open Collective" /></a>
<a href="https://opencollective.com/nest#sponsor" target="_blank"><img src="https://opencollective.com/nest/sponsors/badge.svg" alt="Sponsors on Open Collective" /></a>
  <a href="https://paypal.me/kamilmysliwiec" target="_blank"><img src="https://img.shields.io/badge/Donate-PayPal-ff3f59.svg" alt="Donate us"/></a>
    <a href="https://opencollective.com/nest#sponsor"  target="_blank"><img src="https://img.shields.io/badge/Support%20us-Open%20Collective-41B883.svg" alt="Support us"></a>
  <a href="https://twitter.com/nestframework" target="_blank"><img src="https://img.shields.io/twitter/follow/nestframework.svg?style=social&label=Follow" alt="Follow us on Twitter"></a>
</p>
  <!--[![Backers on Open Collective](https://opencollective.com/nest/backers/badge.svg)](https://opencollective.com/nest#backer)
  [![Sponsors on Open Collective](https://opencollective.com/nest/sponsors/badge.svg)](https://opencollective.com/nest#sponsor)-->

## Description

[Nest](https://github.com/nestjs/nest) framework TypeScript starter repository.

## Project setup

```bash
$ npm install
```

## Development environment

There is a **single source of truth for local data**: the containerized
Postgres/Redis/Mailpit defined in `docker-compose.yml`. Start them with:

```bash
$ docker compose up -d postgres redis mailpit
```

The app shares one canonical `.env` across both run modes, so whatever you use,
the reset-password and login flows hit the **same** database (a password reset
is always visible at the next login):

- **Docker**: `docker compose up -d --build` — the app connects to the compose
  services by name (`postgres`, `redis`, `mailpit`); compose overrides only the
  hostnames and container-internal ports inline under `app.environment`.
- **Native** (`npm run start:dev`): the same `.env` points at the published
  ports (`localhost:5432` Postgres, `localhost:6380` Redis, `localhost:1025`
  Mailpit), so native dev uses the identical data volume.

The unique Docker-only values (service hostnames, internal ports, `NODE_ENV`,
and the migrate/seed-on-start switches) live only in the compose file — there is
no separate `.env.docker` to keep in sync.

> **One database, no duplicates.** A second, host-installed Postgres on
> `localhost:5432` previously caused `401 Invalid credentials` after a password
> reset: it held a separate `my_app` database, so a reset that landed there was
> invisible to the app's own Postgres. That native `postgresql-x64-18` service is
> now **disabled**; the Docker Postgres is exposed on `5432` and is the only
> database. Do not enable a second Postgres or start a native one on `5432`, or
> reset/login will diverge again.

## Compile and run the project

```bash
# development
$ npm run start

# watch mode
$ npm run start:dev

# production mode
$ npm run start:prod
```

## Run tests

**Prerequisites:** the e2e suites boot the real Nest app, so Postgres and Redis
must be reachable (match the values in `.env`, e.g. via the project's compose
setup). Run migrations and seed the baseline roles/permissions before the first
e2e run.

```bash
# check-only lint (CI) / auto-fix (local)
$ npm run lint
$ npm run lint:fix

# typecheck the tests
$ npm run typecheck

# unit tests
$ npm test

# unit tests with coverage (enforced coverage gate)
$ npm run test:cov

# e2e tests (needs Postgres + Redis; migrations + seed first)
$ npm run migration:run
$ npm run seed
$ npm run test:e2e

# reset data left behind by automated tests (rbac_*, e2e_*, users_* accounts)
$ npm run cleanup:test-data
```

**CI:** `.github/workflows/ci.yml` runs lint, typecheck, unit tests (with the
coverage gate) and e2e tests against ephemeral Postgres + Redis service
containers on every push and pull request.

## Deployment

When you're ready to deploy your NestJS application to production, there are some key steps you can take to ensure it runs as efficiently as possible. Check out the [deployment documentation](https://docs.nestjs.com/deployment) for more information.

If you are looking for a cloud-based platform to deploy your NestJS application, check out [Mau](https://mau.nestjs.com), our official platform for deploying NestJS applications on AWS. Mau makes deployment straightforward and fast, requiring just a few simple steps:

```bash
$ npm install -g @nestjs/mau
$ mau deploy
```

With Mau, you can deploy your application in just a few clicks, allowing you to focus on building features rather than managing infrastructure.

## Resources

Check out a few resources that may come in handy when working with NestJS:

- Visit the [NestJS Documentation](https://docs.nestjs.com) to learn more about the framework.
- For questions and support, please visit our [Discord channel](https://discord.gg/G7Qnnhy).
- To dive deeper and get more hands-on experience, check out our official video [courses](https://courses.nestjs.com/).
- Deploy your application to AWS with the help of [NestJS Mau](https://mau.nestjs.com) in just a few clicks.
- Visualize your application graph and interact with the NestJS application in real-time using [NestJS Devtools](https://devtools.nestjs.com).
- Need help with your project (part-time to full-time)? Check out our official [enterprise support](https://enterprise.nestjs.com).
- To stay in the loop and get updates, follow us on [X](https://x.com/nestframework) and [LinkedIn](https://linkedin.com/company/nestjs).
- Looking for a job, or have a job to offer? Check out our official [Jobs board](https://jobs.nestjs.com).

## Support

Nest is an MIT-licensed open source project. It can grow thanks to the sponsors and support by the amazing backers. If you'd like to join them, please [read more here](https://docs.nestjs.com/support).

## Stay in touch

- Author - [Kamil Myśliwiec](https://twitter.com/kammysliwiec)
- Website - [https://nestjs.com](https://nestjs.com/)
- Twitter - [@nestframework](https://twitter.com/nestframework)

## License

Nest is [MIT licensed](https://github.com/nestjs/nest/blob/master/LICENSE).

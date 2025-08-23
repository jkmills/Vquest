# Vquest

Vquest is a minimal virtual questing game powered by an AI dungeon master. A main
instance of the game hosts a room that players can join from their mobile
devices. Players propose actions for each step in the quest and then vote on the
## Vquest

Vquest is a minimal virtual questing game powered by an AI dungeon master. A main
instance of the game hosts a room that players can join from their mobile
devices. Players propose actions for each step in the quest and then vote on the
submitted options.

## Running the server

Install the dependencies and start the Node server:

```bash
npm install
npm start
```

Open `static/player.html` on a phone or browser for the player view and
`static/dm.html?code=ROOMCODE` on a large display for the DM screen. These
pages are built with React and communicate with the server using WebSockets.

## Remote testing over the internet

This repository includes a `render.yaml` configuration for one-click deploys on
[Render](https://render.com).

### Usage

1. Push this repository to a public GitHub repo.
2. Create a new web service on Render and choose "Deploy from repository".
3. Render reads `render.yaml`, installs dependencies, and starts the app with
   `npm start`.
4. Render sets the `PORT` environment variable automatically and provides a
   public URL to share.

### Troubleshooting

- If the Render service doesn't start, ensure `render.yaml` is present,
  dependencies installed, and the app is binding to `0.0.0.0` on the `PORT`
  environment variable.

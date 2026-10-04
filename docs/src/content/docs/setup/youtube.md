---
title: Set up YouTube
description: Add YouTube channels, turn on live stream checks with an API key and sign in to see your subscriptions.
---

YouTube works in three steps, and each one adds more:

1. **Channels only.** Up Next reads each channel's RSS feed, which needs no account. Uploads from the last 7 days show in the feed, and new ones notify you.
2. **An API key.** Up Next also looks the videos up, so live streams show as live, with viewer counts, and scheduled streams as upcoming.
3. **Signing in with Google.** Up Next also reads your subscriptions. Uploads and live streams from subscriptions that aren't in `channels.yml` show in their own group, and `upnext channel add` can pick from them.

Signing in also covers the video lookups, so with step 3 you don't need the API key from step 2.

## Add channels

Add a channel by its ID, which starts with `UC`, or paste its `/channel/` URL:

```bash
upnext channel add youtube UCxxxxxxxxxxxxxxxxxxxxxx
```

To find a channel's ID, open the channel, select the description, then **Share channel** and **Copy channel ID**.

A channel you've just added doesn't notify you about its existing uploads. Once you've signed in with Google, you can pick from your subscriptions instead. See [Pick from your subscriptions](#pick-from-your-subscriptions).

## Create a Google Cloud project

Both the API key and the sign-in come from a Google Cloud project:

1. Open the [Google Cloud console](https://console.cloud.google.com/) and create a project, such as `upnext`.
2. Go to **APIs & Services**, then **Library**, find **YouTube Data API v3** and select **Enable**.

## Get an API key

Skip this if you're going to sign in.

1. In the project, go to **APIs & Services**, then [Credentials](https://console.cloud.google.com/apis/credentials).
2. Select **Create credentials**, then **API key**.
3. Edit the key, and under **API restrictions** pick **Restrict key** and choose **YouTube Data API v3**.
4. Put it in `config.yml`, then restart the daemon:

```yaml
youtube:
  api_key: your-api-key
```

```bash
systemctl --user restart upnext.service
```

## Sign in with Google

### Set up the consent screen

1. In the project, open [Google Auth Platform](https://console.cloud.google.com/auth/overview) and select **Get started**.
2. Fill in **App information** with an app name, such as `Up Next`, and your email address.
3. Under **Audience**, choose **External**.
4. Add your email address as the contact, agree to the policy and select **Create**.
5. Go to **Branding**. Google needs a home page and a privacy policy before it publishes an app:
   - **Application home page**: `https://upnext.timmo.dev`
   - **Application privacy policy link**: `https://upnext.timmo.dev/privacy`
   - **Authorised domains**: `timmo.dev`
   - Leave the logo empty. Adding one means Google has to verify the app.
6. Select **Save**.
7. Go to **Audience** and select **Publish app**, then **Confirm**.

Publishing matters. While an app is in testing, Google expires its sign-ins after 7 days, and you'd need to run `upnext auth youtube` every week. A published app that Google hasn't verified works for up to 100 people, which is plenty for your own use. Google warns you that it isn't verified when you sign in.

### Create an OAuth client

1. Go to **Clients** and select **Create client**.
2. Choose **Desktop app** as the application type, and give it a name.
3. Select **Create**, then copy the **Client ID** and **Client secret**.
4. Put them in `config.yml`, then restart the daemon:

```yaml
youtube:
  client_id: your-client-id.apps.googleusercontent.com
  client_secret: your-client-secret
```

```bash
systemctl --user restart upnext.service
```

A desktop client doesn't need a redirect URL. Up Next listens on `http://127.0.0.1:8081` only while you sign in.

### Sign in

```bash
upnext auth youtube
```

Your browser opens Google's sign-in page:

1. Pick your Google account. If you have a brand account for YouTube, pick that instead.
2. Google says it hasn't verified the app. Select **Advanced**, then **Go to Up Next (unsafe)**. It's your own app, so this is expected.
3. Allow Up Next to view your YouTube account, then select **Continue**.

The command prints `Signed in.` once the daemon has read your subscriptions. The daemon keeps a refresh token in `state.json`. If Google stops accepting it, the YouTube status in the feed changes to `auth-required`. Run `upnext auth youtube` again.

## Pick from your subscriptions

Once you've signed in, run `upnext channel add` with no channel ID to pick from your subscriptions:

```bash
upnext channel add youtube
```

Move with Up and Down, press Space to pick each channel, then Enter to add them. Add `--open` to open their live streams as soon as they start.

Channels in `channels.yml` come first, and they're the only ones that notify you. Your other subscriptions still show, so you can see what's new:

- Their uploads from the last 7 days go in the panel's **Other uploads** group.
- Their live streams show after your channels', ordered by viewers.
- Their scheduled streams don't show.

## Quota

The YouTube Data API gives each project 10,000 units of quota a day. Each check, every `youtube.poll_interval` seconds (600 by default), costs about:

- 1 unit per 50 subscriptions, to read them.
- 1 unit per 50 videos to look up. Up Next looks up every video in a `channels.yml` channel's feed, but only the last 7 days of uploads from other subscriptions.

With a few hundred subscriptions that comes to around 2,000 units a day, well within the limit. If you do hit it, the YouTube status shows the error until quota resets at midnight Pacific time. Raise `youtube.poll_interval` to check less often.

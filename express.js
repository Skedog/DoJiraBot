const log = require('npmlog');
const express = require('express');
const bodyParser = require("body-parser")
const https = require('https');
const fs = require('fs');
const discord = require('./discord.js');
const config = require('./config.js');

function addHandledWebhook(webhookID) {
	fs.appendFile('db/handled-events.txt', webhookID + '\r\n', function(err) {
		if (err) {
			log.error('err writing to handled events');
		}
	});
}

async function findUser(userToFind) {
	const userList = fs.readFileSync('db/user-list.txt','utf-8');
	const lines = userList.split('\r\n');
	for (const line of lines) {
		if (line.indexOf(userToFind) > -1) {
			return line;
		};
	};
}

async function fixLinks(textToFix) {
	if (textToFix?.includes('[https://')){
		const links = (textToFix.match(/\[(.*?)\]/g) || []);
		for (var x = 0; x < links.length; x++) {
			const linkSplit = links[x].split('|');
			const finalLink = linkSplit[0].replace('[','');
			textToFix = textToFix.replace(links[x],finalLink);
		}
	}
	return textToFix;
}

async function pingUsersAndFixDescription(textToFix,shouldPingUsers) {
	const userPings = textToFix.match(/[^[\]]+(?=])/g);
	let usersToPing = '';
	for (var i = userPings.length - 1; i >= 0; i--) {
		const userID = userPings[i].replace('~accountid:','');
		const returnedUser = await findUser(userID);
		const userSplit = returnedUser.split(',');
		const userPingsEnabled = userSplit[2];
		if (userPingsEnabled == 'true' && shouldPingUsers) {
			// No need to ping the same person twice
			if (!usersToPing.includes(userSplit[1])) {
				usersToPing = usersToPing + '<@' + userSplit[1] + '> ';
			}
		}
		textToFix = textToFix.replace('[~accountid:' + userID + ']','<@' + userSplit[1] + '>')
	};
	if (usersToPing) {
		discord.sendChatMessage(usersToPing);
	};
	return textToFix;
}

async function start() {
	const app = express();
	app.use(bodyParser.urlencoded({extended: true}));
	app.use(bodyParser.json());

	const httpsServer = https.createServer({
		key: fs.readFileSync('cert/privkey.pem'),
		cert: fs.readFileSync('cert/fullchain.pem'),
	}, app);
	httpsServer.listen(2096, () => {log.info('HTTPS Server running on port 2096')});

	app.get('/', (req, res) => {
		res.send('Hello!');
	});

	app.post("/hook", async (req, res) => {
		if (req.body) {
			try {
				let discordData = {};
				const currentWebhookID = req.header('X-Atlassian-Webhook-Identifier');
				log.info('webhookID: ' + currentWebhookID);
				const fileData = fs.readFileSync('db/handled-events.txt');
				if (fileData.indexOf(currentWebhookID) == -1) {
					log.info('webhookEvent: ' + req.body.webhookEvent);

					addHandledWebhook(currentWebhookID);

					if (req.body.webhookEvent === 'jira:issue_deleted') {
						discordData.color = '#FF0000';
						discordData.URLtoUse = config.baseJiraURL + '/browse/' + req.body.issue.key;
						discordData.type = req.body.issue.fields.issuetype.name + ' Deleted';
						discordData.fieldTitle1 = req.body.issue.fields.issuetype.name + ' Title';
						discordData.fieldText1 = req.body.issue.fields.summary;
						discordData.fieldTitle2 = req.body.issue.fields.issuetype.name + ' Description';
						discordData.fieldText2 = await fixLinks(req.body.issue.fields.description);
						discord.sendEmbedMessage(discordData);
					}

					if (req.body.webhookEvent === 'jira:issue_created') {
						discordData.color = '#42CA55';
						discordData.URLtoUse = config.baseJiraURL + '/browse/' + req.body.issue.key;
						discordData.type = req.body.issue.fields.issuetype.name + ' Created';
						discordData.fieldTitle1 = req.body.issue.fields.issuetype.name + ' Title';
						discordData.fieldText1 = req.body.issue.fields.summary;
						discordData.fieldTitle2 = req.body.issue.fields.issuetype.name + ' Description';
						discordData.fieldText2 = await fixLinks(req.body.issue.fields.description);
						if (discordData.fieldText2?.includes('[~accountid:')) {
							// at least one person has been mentioned in the description, we need to possibly ping them on Discord
							discordData.fieldText2 = await pingUsersAndFixDescription(discordData.fieldText2, true);
						}

						// If the new issue has been assigned to someone, we need to ping that person on Discord
						if (req.body.issue.fields.assignee) {
							const issuedAssignedTo = req.body.issue.fields.assignee.displayName;
							const returnedUser = await findUser(issuedAssignedTo);
							const userSplit = returnedUser.split(',');
							const userDiscordID = userSplit[1];
							const userPingsEnabled = userSplit[2];
							if (userPingsEnabled) {
								discord.sendChatMessage('<@' + userDiscordID + '>');
							}
						}
						discord.sendEmbedMessage(discordData);
					}

					if (req.body.webhookEvent === 'jira:issue_updated') {
						discordData.color = '#F5840B';
						discordData.description = req.body.issue.fields.summary;
						for (const changelogItem of req.body.changelog.items) {
							log.info('Issue Updated Changelog Field: ' + changelogItem.field);
							if (changelogItem.field === 'summary') {
								discordData.type = req.body.issue.fields.issuetype.name + ' Summary Updated';
								discordData.fieldTitle1 = 'Previous Summary';
								discordData.fieldTitle2 = 'New Summary';
								discordData.fieldText1 = changelogItem.fromString;
								discordData.fieldText2 = changelogItem.toString;
								discordData.URLtoUse = config.baseJiraURL + '/browse/' + req.body.issue.key;
								discord.sendEmbedMessage(discordData);
							}
							if (changelogItem.field === 'description') {
								discordData.type = req.body.issue.fields.issuetype.name + ' Description Updated';
								discordData.fieldTitle1 = 'Previous Description';
								discordData.fieldTitle2 = 'New Description';
								discordData.fieldText1 = await fixLinks(changelogItem.fromString);
								if (discordData.fieldText1?.includes('[~accountid:')) {
									// Someone was mentioned before and the description was updated now but we don't want to ping users based on the previous description
									discordData.fieldText1 = await pingUsersAndFixDescription(discordData.fieldText1, false);
								}
								discordData.fieldText2 = await fixLinks(changelogItem.toString);
								if (discordData.fieldText2?.includes('[~accountid:')) {
									// at least one person has been mentioned in the description, we need to possibly ping them on Discord
									discordData.fieldText2 = await pingUsersAndFixDescription(discordData.fieldText2, true);
								}
								discordData.URLtoUse = config.baseJiraURL + '/browse/' + req.body.issue.key;
								discord.sendEmbedMessage(discordData);
							}
							if (changelogItem.field === 'status') {
								discordData.type = req.body.issue.fields.issuetype.name + ' Status Updated';
								discordData.fieldTitle1 = 'Previous Status';
								discordData.fieldTitle2 = 'New Status';
								discordData.fieldText1 = changelogItem.fromString;
								discordData.fieldText2 = changelogItem.toString;
								discordData.URLtoUse = config.baseJiraURL + '/browse/' + req.body.issue.key;
								discord.sendEmbedMessage(discordData);
							}
							if (changelogItem.field === 'assignee') {
								if (changelogItem.toString != null) {
									discordData.type = req.body.issue.fields.issuetype.name + ' Assignment Updated';
									const returnedUser = await findUser(changelogItem.to);
									const userSplit = returnedUser.split(',');
									const userDiscordID = userSplit[1];
									const userPingsEnabled = userSplit[2];
									if (userPingsEnabled) {
										discord.sendChatMessage('<@' + userDiscordID + '>');
									}
									discordData.fieldTitle1 = 'Now Assigned To';
									discordData.fieldText1 = changelogItem.toString;
									discordData.URLtoUse = config.baseJiraURL + '/browse/' + req.body.issue.key;
									discord.sendEmbedMessage(discordData);
								}
							}
							if (changelogItem.field === 'priority') {
								if (changelogItem.toString != null) {
									discordData.type = req.body.issue.fields.issuetype.name + ' Priority Updated';
									if (req.body.issue.fields.assignee) {
										const returnedUser = await findUser(req.body.issue.fields.assignee.accountId);
										const userSplit = returnedUser.split(',');
										const userDiscordID = userSplit[1];
										const userPingsEnabled = userSplit[2];
										if (userPingsEnabled) {
											discord.sendChatMessage('<@' + userDiscordID + '>');
										}
									}
									discordData.fieldTitle1 = 'Previous Priority';
									discordData.fieldTitle2 = 'New Priority';
									discordData.fieldText1 = changelogItem.fromString;
									discordData.fieldText2 = changelogItem.toString;
									discordData.URLtoUse = config.baseJiraURL + '/browse/' + req.body.issue.key;
									discord.sendEmbedMessage(discordData);
								}
							}
						}
					}
					if (req.body.webhookEvent === 'comment_created') {
						discordData.type = 'Comment Added';
						discordData.color = '#42CA55';
						discordData.fieldTitle1 = req.body.issue.fields.issuetype.name + ' Title';
						discordData.fieldText1 = req.body.issue.fields.summary;
						discordData.fieldTitle2 = 'New Comment from ' + req.body.comment.updateAuthor.displayName;
						discordData.fieldText2 = await fixLinks(req.body.comment.body);
						if (discordData.fieldText2?.includes('[~accountid:')) {
							// at least one person has been mentioned in this comment, we need to possibly ping them on Discord
							discordData.fieldText2 = await pingUsersAndFixDescription(discordData.fieldText2, true);
						}
						discordData.URLtoUse = config.baseJiraURL + '/browse/' + req.body.issue.key + '?focusedCommentId=' + req.body.comment.id;
						discord.sendEmbedMessage(discordData);
					}
				} else {
					log.info('Already handled webhookID: '+ currentWebhookID);
				}
			} catch (err) {
				log.error(err);
			}
		}
		// its important we end the post no matter what
		res.status(200).end();
	})
}

module.exports = {
	start
};
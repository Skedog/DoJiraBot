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
	if (textToFix) {
		if (textToFix.includes('[https://')){
			const links = (textToFix.match(/\[(.*?)\]/g) || []);
			for (var x = 0; x < links.length; x++) {
				const linkSplit = links[x].split('|');
				const finalLink = linkSplit[0].replace('[','');
				textToFix = textToFix.replace(links[x],finalLink);
			}
		}
	}
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
						// If the new issue has been assigned to someone, we need to ping that person on Discord
						if (req.body.issue.fields.assignee) {
							const issuedAssignedTo = req.body.issue.fields.assignee.displayName;
							const returnedUser = await findUser(issuedAssignedTo);
							const userSplit = returnedUser.split(',');
							const userDiscordID = userSplit[1];
							discord.sendChatMessage('<@' + userDiscordID + '>');
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
								discordData.fieldText2 = await fixLinks(changelogItem.toString);
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
									discord.sendChatMessage('<@' + userDiscordID + '>');
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
										discord.sendChatMessage('<@' + userDiscordID + '>');
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
						discordData.fieldText2 = req.body.comment.body;
						if (discordData.fieldText2.includes('[~accountid:')) {
							// at least one person has been mentioned in this comment, we need to ping them on Discord
							const numPings = (discordData.fieldText2.match(/accountid/g) || []).length;
							const dataSplit = discordData.fieldText2.split(' ');
							let usersToPing = '';
							for (var i = numPings - 1; i >= 0; i--) {
								const userID = dataSplit[i].replace('[~accountid:','');
								const finalUserID = userID.split(']');
								const returnedUser = await findUser(finalUserID[0]);
								const userSplit = returnedUser.split(',');
								usersToPing = usersToPing + '<@' + userSplit[1] + '> ';
							};
							if (usersToPing) {
								discord.sendChatMessage(usersToPing);
							};
							dataSplit.splice(0,numPings);
							discordData.fieldText2 = usersToPing + ' ' + dataSplit.join(' ');
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
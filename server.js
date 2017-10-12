/**
 * Copyright (c) 2015-present, Facebook, Inc.
 * All rights reserved.
 *
 * This source code is licensed under the BSD-style license found in the
 * LICENSE file in the root directory of this source tree. An additional grant
 * of patent rights can be found in the PATENTS file in the same directory.
 */

require('babel-core/register');

var bl = require('bl');
var config = require('./package.json').config;
var express = require('express');
var fs = require('fs');
var mentionBot = require('./mention-bot.js');
var messageGenerator = require('./message.js');
var util = require('util');
var request = require('request');
var CONFIG_PATH = '.mention-bot';
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";//ignore ssl errors

if (!process.env.GITLAB_TOKEN || !process.env.GITLAB_URL || !process.env.GITLAB_USER || !process.env.GITLAB_PASSWORD) {
    console.error('GITLAB_TOKEN, GITLAB_URL, GITLAB_USER, GITLAB_PASSWORD are required environment variables');
    process.exit(1);
}


var app = express();

function buildMentionSentence(reviewers) {
    var atReviewers = reviewers.map(function(owner) { return '@' + owner; });

    if (reviewers.length === 1) {
        return atReviewers[0];
    }

    return (
        atReviewers.slice(0, atReviewers.length - 1).join(', ') +
        ' et ' + atReviewers[atReviewers.length - 1]
    );
}

function defaultMessageGenerator(reviewers) {
    return util.format(
        'By analyzing the blame information on this pull request' +
        ', we identified %s to be%s potential reviewer%s',
        buildMentionSentence(reviewers),
        reviewers.length > 1 ? '' : ' a',
        reviewers.length > 1 ? 's' : ''
    );
};

app.post('/', function(req, res) {
    var eventType = req.get('X-Gitlab-Event');
    console.log('Received push event: ' + eventType);

    //only respond to merge request events
    if(eventType != 'Merge Request Hook'){
        return res.end();
    }

    req.pipe(bl(function(err, body) {
        var data = {};
        try { data = JSON.parse(body.toString()); } catch (e) {}
        if (data.object_attributes.state !== 'opened') {
            console.log(
                'Skipping because action is ' + data.object_attributes.state + '.',
                'We only care about opened.'
            );
            return res.end();
        }

        request({
            url : process.env.GITLAB_URL + '/api/v3/projects/' + data.object_attributes.target_project_id + '/merge_request/' + data.object_attributes.id + '/changes',
            headers : {
                'PRIVATE-TOKEN' : process.env.GITLAB_TOKEN
            }
        },function(error, response, body){
            if (error || response.statusCode != 200) {
                console.log('Error getting merge request diff: ' + error);
                return res.end();
            }

            var merge_data = {};
            try { merge_data = JSON.parse(body.toString()); } catch (e) {}
            if(data.object_attributes.action != 'update'){
                mentionBot.guessOwnersForPullRequest(
                    data.object_attributes.source.web_url,//repo url
                    data.object_attributes.last_commit.id,//sha1 of last commit
                    merge_data.changes,//all files for this merge request
                    data.user.name, // 'mention-bot'
                    data.user.username, // 'username of creator'
                    {}
                ).then(function(reviewers){


                    if (reviewers.length === 0) {
                        console.log('Skipping because there are no reviewers found.');
                        request.debug = true;
                        var url = process.env.GITLAB_URL + '/api/v3/projects/' + data.object_attributes.target_project_id + '/users?private_token='+ process.env.GITLAB_TOKEN ;

                        request(url, function (error, response, body) {
                            var body_tmp =  JSON.parse(body);
                            var members = [];
                            for(var i= 0; i < body_tmp.length; i++)
                            {
                                if( data.user.username  != body_tmp[i].username){
                                    members.push(body_tmp[i].username);
                                }
                            }

                            var url_users_bloced = process.env.GITLAB_URL + '/api/v3/projects/' + data.object_attributes.target_project_id + '/users?private_token='+ process.env.GITLAB_TOKEN  ;
                            // var url_users_bloced = process.env.GITLAB_URL + '/api/v3/projects/'+768+'/users?private_token='+ process.env.GITLAB_TOKEN ;
                            var members_blocked = [];
                            request(url_users_bloced, function (error, response, body) {
                                var body_tmp =  JSON.parse(body);
                                for(var i= 0; i < body_tmp.length; i++)
                                {
                                    if( data.user.username  != body_tmp[i].username){
                                        if(body_tmp[i].state == "blocked" ){
                                            members_blocked.push(body_tmp[i].username);
                                        }
                                    }
                                }
                                var members_tmp =[];

                                for(var i= 0; i < members.length; i++)
                                {
                                    for(var j=0 ; j<members_blocked.length; j++ ){
                                        if(members_blocked[j] !== members[i]){
                                            members_tmp.push(members[i]);
                                        }
                                    }
                                }
                                if(members_tmp.length>0){
                                    members = members_tmp ;
                                }
                                if(members.length > 2){
                                    var rand1 = members[Math.floor(Math.random() * members.length)] ,
                                        rand2 = members[Math.floor(Math.random() * members.length)];
                                    members = [];
                                    if(rand1 != rand2){
                                        members.push(rand1);
                                        members.push(rand2);
                                    }else{
                                        members.push(rand1);
                                        rand2 = members[Math.floor(Math.random() * members.length)];
                                        members.push(rand2);
                                    }
                                }else{
                                    if(members.length == 0){
                                        var members_g = [];
                                        var url_groups = process.env.GITLAB_URL + '/api/v3/groups?private_token='+ process.env.GITLAB_TOKEN ,
                                            list_groupsID = [];

                                        request(url_groups, function (error, response, groups) {
                                            var groups_tmp =  JSON.parse(groups);
                                            for(var i= 0; i < groups_tmp.length; i++)
                                            {
                                                if(groups_tmp[i].visibility_level > 0){
                                                    list_groupsID.push(groups_tmp[i].id);
                                                }
                                            }
                                            if(list_groupsID.length>0){
                                                var IdGourpsAlt = list_groupsID[Math.floor(Math.random() * list_groupsID.length)] ,
                                                    Members_groupURL = process.env.GITLAB_URL + '/api/v3/groups/' + IdGourpsAlt + '/members?private_token='+ process.env.GITLAB_TOKEN ;
                                                request(Members_groupURL, function (error, response, members) {

                                                    var members_tmp =  JSON.parse(members),
                                                        Members_group =[];
                                                    if(members_tmp.length > 0){
                                                        for(var i= 0; i < members_tmp.length; i++)
                                                        {
                                                            if( data.user.username  != members_tmp[i].username){
                                                                if(members_tmp[i].state != "blocked" ){
                                                                    Members_group.push(members_tmp[i].username);
                                                                }
                                                            }
                                                        }

                                                        if(Members_group.length>0){
                                                            members_g = Members_group ;
                                                        }

                                                        if(members_g.length > 2){
                                                            var rand1 = members_g[Math.floor(Math.random() * members_g.length)] ,
                                                                rand2 = members_g[Math.floor(Math.random() * members_g.length)];
                                                            members_g = [];
                                                            if(rand1 != rand2){
                                                                members_g.push(rand1);
                                                                members_g.push(rand2);
                                                            }else{
                                                                members_g.push(rand1);
                                                                rand2 = members_g[Math.floor(Math.random() * members_g.length)];
                                                                members_g.push(rand2);
                                                            }
                                                        }
                                                    }

                                                    request.post({
                                                        url : process.env.GITLAB_URL + '/api/v3/projects/' + data.object_attributes.target_project_id + '/merge_requests/' + data.object_attributes.id + '/comments',
                                                        body: JSON.stringify({
                                                            note : messageGenerator(
                                                                members_g,
                                                                data.user.username,
                                                                buildMentionSentence,
                                                                defaultMessageGenerator)
                                                        }),
                                                        headers : {
                                                            'PRIVATE-TOKEN' : process.env.GITLAB_TOKEN,
                                                            'Content-Type' : 'application/json'
                                                        }
                                                    },function(commentError, commentResponse, commentBody){
                                                        if (commentError || commentResponse.statusCode != 200) {
                                                            console.log('Error commenting on merge request: ' + commentBody);
                                                        }
                                                    });

                                                });
                                            }
                                        });
                                    }
                                    return;
                                }

                                request.post({
                                    url : process.env.GITLAB_URL + '/api/v3/projects/' + data.object_attributes.target_project_id + '/merge_requests/' + data.object_attributes.id + '/comments',
                                    body: JSON.stringify({
                                        note : messageGenerator(
                                            members,
                                            data.user.username,
                                            buildMentionSentence,
                                            defaultMessageGenerator)
                                    }),
                                    headers : {
                                        'PRIVATE-TOKEN' : process.env.GITLAB_TOKEN,
                                        'Content-Type' : 'application/json'
                                    }
                                },function(commentError, commentResponse, commentBody){
                                    if (commentError || commentResponse.statusCode != 200) {
                                        console.log('Error commenting on merge request: ' + commentBody);
                                    }
                                });
                            });
                            /***********************************************************/
                        });
                        return ;
                    }
                    request.debug = true;

                    /***********************************************************/

                    var url_users_bloced = process.env.GITLAB_URL + '/api/v3/projects/' + data.object_attributes.target_project_id + '/users?private_token='+ process.env.GITLAB_TOKEN ;
                    // var url_users_bloced = process.env.GITLAB_URL + '/api/v3/projects/'+768+'/users?private_token='+ process.env.GITLAB_TOKEN ;
                    console.log("url_users_bloced .... ===> ", url_users_bloced);
                    var members_blocked = [];
                    request(url_users_bloced, function (error, response, body) {
                        var body_tmp =  JSON.parse(body);
                        for(var i= 0; i < body_tmp.length; i++)
                        {
                            if( data.user.username  != body_tmp[i].username){
                                if(body_tmp[i].state == "blocked" ){
                                    members_blocked.push(body_tmp[i].username);
                                }
                            }
                        }
                        console.log("body_tmp members_blocked----------> ", members_blocked);
                        var members_tmp =[];
                        for(var i= 0; i < reviewers.length; i++)
                        {
                            for(var j=0 ; j<members_blocked.length; j++ ){
                                if(members_blocked[j] !== reviewers[i]){
                                    members_tmp.push(reviewers[i]);
                                }
                            }
                        }
                        if(members_tmp.length>0){
                            reviewers = members_tmp ;
                        }
                        if(reviewers.length > 2){
                            var rand1 = reviewers[Math.floor(Math.random() * reviewers.length)] ,
                                rand2 = reviewers[Math.floor(Math.random() * reviewers.length)];
                            reviewers = [];
                            if(rand1 != rand2){
                                reviewers.push(rand1);
                                reviewers.push(rand2);
                            }else{
                                reviewers.push(rand1);
                                rand2 = reviewers[Math.floor(Math.random() * reviewers.length)];
                                reviewers.push(rand2);
                            }
                        }else{
                            if(reviewers.length == 0){
                                reviewers = [];
                                var url_groups = process.env.GITLAB_URL + '/api/v3/groups?private_token='+ process.env.GITLAB_TOKEN ,
                                    list_groupsID = [];

                                request(url_groups, function (error, response, groups) {
                                    var groups_tmp =  JSON.parse(groups);
                                    for(var i= 0; i < groups_tmp.length; i++)
                                    {
                                        if(groups_tmp[i].visibility_level > 0){
                                            list_groupsID.push(groups_tmp[i].id);
                                        }
                                    }
                                    if(list_groupsID.length>0){
                                        var IdGourpsAlt = list_groupsID[Math.floor(Math.random() * list_groupsID.length)] ,
                                            Members_groupURL = process.env.GITLAB_URL + '/api/v3/groups/' + IdGourpsAlt + '/members?private_token='+ process.env.GITLAB_TOKEN ;
                                        request(Members_groupURL, function (error, response, members) {
                                                var members_tmp =  JSON.parse(members),
                                                    Members_group =[];
                                            if(members_tmp.length > 0){
                                                for(var i= 0; i < members_tmp.length; i++)
                                                {
                                                    if( data.user.username  != members_tmp[i].username){
                                                        if(members_tmp[i].state != "blocked" ){
                                                            Members_group.push(members_tmp[i].username);
                                                        }
                                                    }
                                                }

                                                if(Members_group.length>0){
                                                    reviewers = Members_group ;
                                                }

                                                if(reviewers.length > 2){
                                                    var rand1 = reviewers[Math.floor(Math.random() * reviewers.length)] ,
                                                        rand2 = reviewers[Math.floor(Math.random() * reviewers.length)];
                                                    reviewers = [];
                                                    if(rand1 != rand2){
                                                        reviewers.push(rand1);
                                                        reviewers.push(rand2);
                                                    }else{
                                                        reviewers.push(rand1);
                                                        rand2 = reviewers[Math.floor(Math.random() * reviewers.length)];
                                                        reviewers.push(rand2);
                                                    }
                                                }
                                            }

                                            request.post({
                                                url : process.env.GITLAB_URL + '/api/v3/projects/' + data.object_attributes.target_project_id + '/merge_requests/' + data.object_attributes.id + '/comments',
                                                body: JSON.stringify({
                                                    note : messageGenerator(
                                                        reviewers,
                                                        data.user.username,
                                                        buildMentionSentence,
                                                        defaultMessageGenerator)
                                                }),
                                                headers : {
                                                    'PRIVATE-TOKEN' : process.env.GITLAB_TOKEN,
                                                    'Content-Type' : 'application/json'
                                                }
                                            },function(commentError, commentResponse, commentBody){
                                                if (commentError || commentResponse.statusCode != 200) {
                                                    console.log('Error commenting on merge request: ' + commentBody);
                                                }
                                            });

                                        });
                                    }
                                });
                                return;
                            }
                        }

                        request.post({
                            url : process.env.GITLAB_URL + '/api/v3/projects/' + data.object_attributes.target_project_id + '/merge_requests/' + data.object_attributes.id + '/comments',
                            body: JSON.stringify({
                                note : messageGenerator(
                                    reviewers,
                                    data.user.username,
                                    buildMentionSentence,
                                    defaultMessageGenerator)
                            }),
                            headers : {
                                'PRIVATE-TOKEN' : process.env.GITLAB_TOKEN,
                                'Content-Type' : 'application/json'
                            }
                        },function(commentError, commentResponse, commentBody){
                            if (commentError || commentResponse.statusCode != 200) {
                                console.log('Error commenting on merge request: ' + commentBody);
                            }
                        });
                    });
                    /***********************************************************/
                });
            }
            return res.end();
        });
    }));
});

app.get('/', function(req, res) {
    res.send(
        'GitHub Mention Bot Active. ' +
        'Go to https://github.com/facebook/mention-bot for more information.'
    );
});

app.set('port', process.env.PORT || 5000);

app.listen(app.get('port'), function() {
    console.log('Listening on port', app.get('port'));
});

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
        console.log("Data is: ", data );
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
                    console.log("rev before " , reviewers);
                    /***********************************************************/
                    var url_users = process.env.GITLAB_URL + '/api/v3/projects/' + data.object_attributes.target_project_id + '/users?private_token='+ process.env.GITLAB_TOKEN ;
                    request(url_users, function (error, response, body) {
                        var body_tmp =  JSON.parse(body);
                        var name = data.user.name;
                        var usernames_tmp =[];
                        var reviewers_tmp =[];

                        // Getting list of users in this project (usernames) and not blocked
                        for(var y=0; y<body_tmp.length; y++){
                            if(name != body_tmp[y].name && body_tmp[y].state != "blocked"){
                                usernames_tmp.push(body_tmp[y].username);
                            }
                            for(var h=0; h<reviewers.length; h++)
                            {
                                // extraire les usernames des noms du reviewers (et ignoré le nom du créateur)
                                if(reviewers[h] == body_tmp[y].name && reviewers[h] != name )
                                {
                                    reviewers_tmp.push(body_tmp[y].username);
                                }
                            }
                        }

                        console.log("reviewers_tmp ... ",reviewers_tmp);
                        reviewers = reviewers_tmp;
                        var  reviewers_g = [] ;
                        var has_group_member = false ;
                        console.log("before send ", reviewers);
                            //test groupe ====> à supprimé
                        reviewers = []; usernames_tmp = [];
                        // getting just 2 users from the list of reviewers
                        if(reviewers.length > 2){
                            var al1 = Math.floor(Math.random() * reviewers.length);
                            var al2 = reviewers.length-1;
                            if(al1 == al2 && al1 !=0){
                                al2=0;
                            }
                            else{
                                if(al1 == al2 && al1 ==0)
                                {
                                    al2 = reviewers.length-1;
                                }
                            }
                            var rand1 =  reviewers[al1], rand2 = reviewers[al2];
                            reviewers = [];
                            reviewers.push(rand1);
                            reviewers.push(rand2);

                        }else{
                            // getting just 2 users from the list of members
                            if(reviewers.length == 0 && usernames_tmp.length > 0){

                                var al1 = Math.floor(Math.random() * usernames_tmp.length);
                                if(usernames_tmp.length > 1){
                                    var al2 = usernames_tmp.length-1;
                                    if(al1 == al2 && al1 !=0){
                                        al2=0;
                                    }
                                    else{
                                        if(al1 == al2 && al1 ==0)
                                        {
                                            al2 = usernames_tmp.length-1;
                                        }
                                    }
                                    reviewers = [];
                                    reviewers.push(usernames_tmp[al1]);
                                    reviewers.push(usernames_tmp[al2]);
                                }
                                else {
                                    reviewers = [];
                                    reviewers.push(usernames_tmp[al1]);
                                }

                            }
                            else{
                                // -----------------------------------------------------------
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
                                        has_group_member = true;
                                        var IdGourpsAlt = list_groupsID[Math.floor(Math.random() * list_groupsID.length)] ,
                                            Members_groupURL = process.env.GITLAB_URL + '/api/v3/groups/' + IdGourpsAlt + '/members?private_token='+ process.env.GITLAB_TOKEN ;
                                        request(Members_groupURL, function (error, response, members) {
                                            var members_tmp =  JSON.parse(members),
                                                Members_group =[];
                                            console.log("members_tmp ==> ", members_tmp);


                                            // Getting list of users in this groupe (usernames) and not blocked
                                            for(var d=0; d<members_tmp.length; d++){
                                                if(name != members_tmp[d].name && members_tmp[d].state != "blocked"){
                                                    Members_group.push(members_tmp[d].username);
                                                }
                                            }

                                            reviewers_g = Members_group;
                                                        console.log("Members_group =====> ",Members_group);
                                            // getting just 2 users from the list of reviewers
                                            if(reviewers_g.length > 2){
                                                var al1 = Math.floor(Math.random() * reviewers_g.length);
                                                var al2 = reviewers_g.length-1;
                                                if(al1 == al2 && al1 !=0){
                                                    al2=0;
                                                }
                                                else{
                                                    if(al1 == al2 && al1 ==0)
                                                    {
                                                        al2 = reviewers_g.length-1;
                                                    }
                                                }
                                                var rand1 =  reviewers_g[al1], rand2 = reviewers_g[al2];
                                                reviewers_g = [];
                                                reviewers_g.push(rand1);
                                                reviewers_g.push(rand2);

                                            }
                                        });
                                    }
                                });
                                console.log("reviewers_g roupe =====> ",reviewers_g);
                                if(has_group_member){
                                    reviewers =    reviewers_g;
                                }
                                console.log("has_group_member =====> ",has_group_member);
                                console.log("reviewers of  groupe =====> ",reviewers);
                                // -----------------------------------------------------------
                            }
                        }
                        console.log("reviewers_g ==> ", reviewers);
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

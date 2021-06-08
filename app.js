console.log("\nCommitmentBot loading.\n");
//==========================================================================================================================================================
//==========================================================================================================================================================
//==========================================================================================================================================================


var account = 'S-XXXX-XXXX-XXXX-XXXXX'; //Burst-Signa RSAddress to monitor.
var passphrase = 'your twelve words here'; //The passphrase for your Burst-Signa Address in order to broadcast the commitments. 

var commitLevel = 10; //Commit coins when this many are available.
var commitAmount = 100; //How much of the available balance to commit as a percentage (0 - 100)

var burstNode = '127.0.0.1'; //URL of a burst node where you have access to the API, (!!Only ever use Burst-Signa Nodes that you personally know and trust with your passphrase!!)
var burstNodePort = 8125; //The port number the Burst-Node node has its API on, usually 8125
var checkSeconds = 900; //Seconds between available balance checks.


var feeType = 'cheap'; //Which suggested fee to use, cheap/standard/priority (See current fees here: Https://europe.signum.network/burst?requestType=suggestFee)
var feeMult = 1.05; //Multiplier for the network suggested fees.


//==========================================================================================================================================================
//==========================================================================================================================================================
//==========================================================================================================================================================


const http = require('http')
const ver = '0.0.1';
const req_account = {
	hostname: burstNode,
	port: burstNodePort,
	path: `/burst?requestType=getAccount&account=${account}&getCommittedAmount=true`,
	headers: { 'User-Agent': `CommitmentBot ${ver}` },
	method: 'GET'
}
const req_fees = {
	hostname: burstNode,
	port: burstNodePort,
	path: `/burst?requestType=suggestFee`,
	headers: { 'User-Agent': `CommitmentBot ${ver}` },
	method: 'GET'
}


//Grab and display current suggested Network Fees & Begin the main loop
function preInit(){
	var req = http.request(req_fees, res => {
		res.setEncoding('utf8');
		res.on('data', d => {
			try {
				var data = JSON.parse(d);
				if(typeof data == "undefined"){console.error("NON JSON");}
				
				console.log(`Current network fees: Cheap ${data['cheap']} | Standard ${data['standard']} | Priority ${data['priority']}\n`);
			}
			catch (e){
				console.error(e);
			}
			//Begin the main loop
			init();
		});
	});

	req.on('error', error => {
		console.error(error)
	});

	req.end();
}


//Check for available balance
function run(){
	
	let date = new Date();
	let time = (new Date()).toTimeString().substr(0,8);
	
	console.log(`${time}: Checking current balance`);

	var req = http.request(req_account, res => {
		//console.log(`statusCode: ${res.statusCode}`)
		res.setEncoding('utf8');
		res.on('data', d => {
			try {
				var data = JSON.parse(d);
				
				var bal = data["guaranteedBalanceNQT"];
				var commitment = data["committedBalanceNQT"];
				if(typeof bal == "undefined" || typeof commitment == "undefined"){
					console.error("API Returned unexpected data: " + d);
					return;
				}
				
				var balHuman = Math.round( bal / 100000000 *100 ) /100;
				var commitmentHuman = Math.round( commitment / 100000000 *100 ) /100;
				var diff = Math.round((balHuman-commitmentHuman) *100 ) /100;
				console.log( ` > ${balHuman} Signa (${commitmentHuman} committed | ${diff} available)\n`);
				
				//Check for unconfirmed Commits
				const req_unconfirmed = {
					hostname: burstNode,
					port: burstNodePort,
					path: encodeURI(`/burst?requestType=getUnconfirmedTransactions&account=${account}`),
					headers: { 'User-Agent': `CommitmentBot ${ver}` },
					method: 'GET'
				}
				
				var req = http.request(req_unconfirmed, res => {
					res.setEncoding('utf8');
					res.on('data', d => {
						try {
							var data = JSON.parse(d);
							let uTransactions = data["unconfirmedTransactions"];
							
							if(typeof uTransactions != "undefined"){
							
								let unconfirmed = 0;
								for (let i = 0; i < uTransactions.length; i++) {
									//If transaction type is Mining Commit then add to total.
									if( uTransactions[i].type == 20 && uTransactions[i].subtype == 1 ){
										let value = parseInt(uTransactions[i]["feeNQT"]) + parseInt(uTransactions[i]["attachment"]["amountNQT"]);
										unconfirmed = unconfirmed + value;
									}
								}
								
								//If available balance (Minus unconfirmed commits) is over the checkLevel then begin the commit process
								if((bal - commitment - unconfirmed) > (commitLevel * 100000000)){
									commit(bal - commitment - unconfirmed, Math.round((bal - commitment - unconfirmed) / 100000000 *100 ) /100 );
								}else if( (bal - commitment) > (commitLevel * 100000000) ){
									let uTransactionsHuman = Math.floor(unconfirmed/100000000);
									console.log(`Skipping commit as there are unconfirmed commits of ~${uTransactionsHuman} Signa\n`);
								}
							}else{
								console.error(`Unexpected unconfirmed transaction data: ${data}`);
							}
						}catch(e){
							console.error("NON JSON? " + e);
						}
				});
			});

			req.on('error', error => {
				console.error(error)
			});

			req.end();
				
			}
			catch (e){
				console.error("NON JSON? " + e);
			}
		});
	});

	req.on('error', error => {
		console.error(error)
	});

	req.end();
	
}

//Calculate fees and coins to commit.
function commit( v, diff ){
	
	//Check passphrase is present correct format
	if(passphrase.split(" ").length != 12){console.error("Malformed Passphrase"); return;}
	
	//Base NQT fee
	let fee = 1000000;
	
	var req = http.request(req_fees, res => {
		res.setEncoding('utf8');
		res.on('data', d => {
			try {
				var data = JSON.parse(d);
				
				feeType = feeType.toLowerCase();
				if(typeof data[feeType] != "undefined"){
					//Calculate Fee to be used for commit
					fee = Math.floor( data[feeType] * feeMult );
					
					//Display Commit info in human readable values
					let commitWithoutFee = Math.round( ( (diff-(fee/100000000) )/100 )*100 *commitAmount ) /100;
					let humanFee = fee/100000000;
					console.log(`Committing: ${commitWithoutFee} Signa \n Fee: ${humanFee} \n`);
					
					//Calculate NQT to commit
					let toCommit = Math.floor( ((v - fee) / 100) * commitAmount );
					
					//Begin the Commit
					sendCommit(toCommit, fee);
									
				}else{
					console.error(`Unknown Fee Type: ${feeType}`);
				}
			}
			catch (e){
				console.error("NON JSON? " + e);
			}
		});
	});

	req.on('error', error => {
		console.error(error)
	});

	req.end();
}


function sendCommit(toCommit, fee){
	
	//POST request with API values in query string as required by BRS spec.
	const req_commit = {
		hostname: burstNode,
		port: burstNodePort,
		path: encodeURI(`/burst?requestType=addCommitment&amountNQT=${toCommit}&secretPhrase=${passphrase}&feeNQT=${fee}&deadline=1440`),
		headers: { 'User-Agent': `CommitmentBot ${ver}` },
		method: 'POST'
	}

	//Build the POST body anyway for future-proofing
	var postData = JSON.stringify({
		"requestType": "addCommitment",
		"amountNQT": toCommit,
		"secretPhrase": passphrase,
		"feeNQT": fee,
		"deadline": 1440
	});
	
	//Create Commit request
	var reqCommit = http.request(req_commit, resCommit => {
		resCommit.setEncoding('utf8');
		if(resCommit.statusCode != 200){
			console.error(`HTTP ERROR ${resCommit.statusCode}`);
		}
		
		resCommit.on('data', d => {
			try {
				var data = JSON.parse(d);
				if(typeof data == "undefined"){console.error("NON JSON"); return;}
				
				if(typeof data['error'] != "undefined"){
					console.error("Error: " + data['error']);
					return;
				}
				
				//console.log(req_commit);
				if(typeof data["errorDescription"] != "undefined"){
					console.error(`API Error: ${data["errorDescription"]}`);
				}else{
					console.log("Commit completed. \n");
				}
				//console.log(data);
			}
			catch (e){
				console.error("NON JSON? " + e);
			}
		});
		
	});
	
	reqCommit.on('error', error => {
		console.error(error)
	});
	
	//Send POST req
	reqCommit.write(postData);
	reqCommit.end();
}


//Display config settings on startup.
console.log(`CommitmentBot ${ver} Running!
- Checking every ${checkSeconds}s
- Committing when ${commitLevel} Signa available
- Committing ${commitAmount}% of available balance.
- Using '${feeType}' fees with a ${feeMult}x multiplier`);


//Grabs the starting fee values to display on startup, then runs init() defined below
preInit(); 


//Begins the main loop
function init(){
	run();
	setInterval(run,checkSeconds * 1000);
}

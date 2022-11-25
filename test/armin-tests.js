const hre = require("hardhat");
const { expect } = require("chai");
const { ethers } = require("hardhat");
const { MerkleTree } = require('merkletreejs');
const keccak256 = require('keccak256');
const fs = require('fs');


describe("Armin Test", function () {

  let Contract;
  let contract;

  let preRoot;
  let preMerkle;

  let owner;
  let addrs; // address

  beforeEach(async function () {
    [owner, ...addrs] = await ethers.getSigners();
    
    let whitelist = fs.readFileSync('./whitelist/localtest.json');
    whitelist = JSON.parse(whitelist);

    const preList = whitelist.pre.map(address => keccak256(ethers.utils.getAddress(address)));

    preMerkle = new MerkleTree(preList, keccak256, {sortPairs : true});
    preRoot = preMerkle.getHexRoot();

    const name = "Test"
    const symbol = "TESTSYMBOL"

    Contract = await ethers.getContractFactory("ArminAAA");
    contract = await Contract.deploy(
      name, 
      symbol
    );
    
    // set merkleRoot
    await contract.setAllowlistRoot(preRoot);

  })

  describe("Test internalMint()", function () {
    it("test max supply", async function () {

      // supplies 
      let maxSupply = await contract.MAX_SUPPLY()

      // mint too many internal tokens -- 
      await expect(contract.internalMint(maxSupply + 1, owner.address)).to.revertedWith("would exceed max supply")

    });
  })

  describe("Test allowlistMint()", function () {

    let allowlistPrice;
    let pubPrice;
    let maxAllowlist;
    let maxAllowlistSupply;
    
    beforeEach(async function () {
      allowlistPrice = ethers.utils.parseEther("0.15")
      pubPrice = ethers.utils.parseEther("0.15")
      // max allowed to mint per wallet on allowlist
      maxAllowlist = await contract.maxAllowlist();
      maxSupply = await contract.MAX_SUPPLY()
      maxAllowlistSupply =  await contract.MAX_ALLOWLIST_SUPPLY()
    })

    it("Test Allowlist Mints", async function () {
      // set allowlist to true
      await contract.setAllowlistActive(true);
      const proof = preMerkle.getHexProof(keccak256(owner.address));

      // mint maxAllowlist
      await contract.allowlistMint(owner.address, maxAllowlist, proof, {value: allowlistPrice.mul(maxAllowlist)})

      // expect total supply to increase by maxAllowlist
      let totalSupply = await contract.totalSupply();
      expect(totalSupply).to.equal(maxAllowlist);

      // try minting 1 more than maxAllowlist
      await expect(contract.allowlistMint(owner.address, 1, proof, {value: allowlistPrice})).to.revertedWith("Exceeded max available to purchase");
      
      // totalSupply should remain the same
      expect(totalSupply).to.equal(maxAllowlist);
    })

    it("Test Ether value sent is correct", async function () {
      // set sale switches to true
      await contract.setPublicActive(true);
      await contract.setAllowlistActive(true);

      const proof = preMerkle.getHexProof(keccak256(owner.address));

      // try sending less than tokenPrice (should fail)
      const preLowPrice = allowlistPrice.sub(ethers.utils.parseEther("0.01"));
      const pubLowPrice = pubPrice.sub(ethers.utils.parseEther("0.01"));

      // presale
      await expect(contract.allowlistMint(owner.address, 1, proof, {value: preLowPrice})).to.revertedWith("Incorrect funds");
   
      // pubsale
      await expect(contract.publicMint(owner.address, 1, {value: pubLowPrice})).to.revertedWith("Incorrect funds");

      // try sending exactly tokenPrice (no problem)
      await expect(await contract.allowlistMint(owner.address, 1, proof, {value: allowlistPrice})).to.changeEtherBalance(owner, new ethers.BigNumber.from("0").sub(allowlistPrice))
      expect(await contract.totalSupply()).to.equal(1);
    })

    it("Test _allowlistCounter is updated and functioning", async function () {
      // set presale to true
      await contract.setAllowlistActive(true);

      // get proof
      const proof = preMerkle.getHexProof(keccak256(owner.address));

      // ensure balance and presale counter are correct, by minting maxAllowlist
      await contract.allowlistMint(owner.address, maxAllowlist, proof, {value: allowlistPrice.mul(maxAllowlist)});
      expect(await contract.balanceOf(owner.address)).to.equal(maxAllowlist);
      expect(await contract._allowlistCounter(owner.address)).to.equal(maxAllowlist);

      // attempt to mint more than counter allows (maxAllowlist)
      await expect(contract.allowlistMint(owner.address, 1, proof, {value: allowlistPrice})).to.revertedWith('Exceeded max available to purchase');
      
      // ensure balance and presale counter are correct
      expect(await contract._allowlistCounter(owner.address)).to.equal(maxAllowlist);
      expect(await contract.balanceOf(owner.address)).to.equal(maxAllowlist);
    })

    it("Test MAX_ALLOWLIST_SUPPLY functions properly", async function () {
      // set presale to true
      await contract.setAllowlistActive(true);

      // set merkle
      const proof = preMerkle.getHexProof(keccak256(owner.address));

      //set maxAllowList (per wallet) to be equal to be 1 larger than MAX_ALLOWLIST_SUPPLY for testing
      await contract.setMaxAllowlist(5);
      await contract.setAllowlistSupply(4);

      //reassign new values
      maxAllowlist = await contract.maxAllowlist();
      maxAllowlistSupply = await contract.MAX_ALLOWLIST_SUPPLY();
      // mint maxAllowListSupply
      await contract.allowlistMint(owner.address, maxAllowlistSupply, proof, {value: allowlistPrice.mul(maxAllowlistSupply)});
      
      // check allowlistMinted counter equals what we just minted
      expect(await contract.allowlistMinted()).to.equal(maxAllowlistSupply);

      // mint 1 more to see that we can't mint more than MAX_ALLOWLIST_SUPPLY
      await expect(contract.allowlistMint(owner.address, 1, proof, {value: allowlistPrice})).to.revertedWith('Purchase would exceed max supply for allowlist mint');
    })

    it("test merkle", async function() {
      // set presale to true
      await contract.setAllowlistActive(true);

      // assign address not in allowlist
      const wrongAddress = '0xf8817128624eA0Ca15400dEE922D81121c9B9839';
      // get proof
      const proof = preMerkle.getHexProof(keccak256(wrongAddress));

      // mint with address that isn't on the allowlist
      await expect(contract.allowlistMint(wrongAddress, 1, proof, {value: allowlistPrice})).to.revertedWith('Invalid MerkleProof');
    });
  });

  describe("Test totalSupply", function () {
    it("test if totalSupply changes if token is tranferred to 0 address", async function () {
      // set public sale to true
      await contract.setPublicActive(true);

      let pubPrice = await contract.PRICE();

      // check totalSupply
      expect(await contract.totalSupply()).to.equal(0);

      // mint a token
      await contract.publicMint(owner.address, 1, {value: pubPrice});
      
      // check supply
      expect(await contract.totalSupply()).to.equal(1);

      // transfer token to 0 address
      await expect(contract.transferFrom(owner.address, ethers.constants.AddressZero, 0)).to.be.revertedWith("TransferToZeroAddress()");

    });
  })

  describe("Test Payment Split Percents", function () {
    it("test splits are accurate", async function () {
      // send 1 ETH into contract
      await owner.sendTransaction({
        to: contract.address,
        value: ethers.utils.parseEther("1.0"), // Sends exactly 1.0 ether
      });

      // check contract balance equals 1 ETH
      expect(await contract.provider.getBalance(contract.address)).to.equal("1000000000000000000");

      //withdraw splits
      await contract.withdrawSplits();

      // check each of the splits is accurate

      // balance of 0x0aaDEEf83545196CCB2ce70FaBF8be1Afa3C9B87 is 10%
      expect(await contract.provider.getBalance("0x0aaDEEf83545196CCB2ce70FaBF8be1Afa3C9B87")).to.equal("100000000000000000")
      // balance of 0x95C62Cfc4dcf2615b6D0Ee27CE17578B8b446C64 is 27.5%
      expect(await contract.provider.getBalance("0x95C62Cfc4dcf2615b6D0Ee27CE17578B8b446C64")).to.equal("275000000000000000")
      // balance of 0x8E245915AE95a14c235FBDA3946d2A12048F92f2 is 31.25%
      expect(await contract.provider.getBalance("0x8E245915AE95a14c235FBDA3946d2A12048F92f2")).to.equal("312500000000000000")
      // balance of 0x4d85c1A432213D965aDCba935520A024399D26c0 is 15.625%
      expect(await contract.provider.getBalance("0x4d85c1A432213D965aDCba935520A024399D26c0")).to.equal("156250000000000000")
      // balance of 0xF69503e221117e7619E9FDdb9665417E7D643BeE is 15.625%
      expect(await contract.provider.getBalance("0xF69503e221117e7619E9FDdb9665417E7D643BeE")).to.equal("156250000000000000")
    });
  });
  
});
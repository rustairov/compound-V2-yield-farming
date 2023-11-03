// SPDX-License-Identifier: UNLICENSED
pragma solidity >=0.4.22 <0.9.0;
pragma abicoder v2;

import '@balancer-labs/v2-interfaces/contracts/vault/IVault.sol';
import '@balancer-labs/v2-interfaces/contracts/vault/IFlashLoanRecipient.sol';
import '@openzeppelin/contracts/utils/Strings.sol';
import '@uniswap/v3-periphery/contracts/interfaces/ISwapRouter.sol';
import '@uniswap/v3-core/contracts/interfaces/IUniswapV3Pool.sol';
import 'hardhat/console.sol';

interface IERC20Extented is IERC20 {
    function decimals() external view returns (uint8);
}

interface ICToken is IERC20Extented {
    function underlying() external view returns (address);

    function mint(uint256 mintAmount) external returns (uint256);

    function redeem(uint256 redeemTokens) external returns (uint256);

    function borrow(uint borrowAmount) external returns (uint);

    function borrowBalanceCurrent(address account) external returns (uint);

    function repayBorrow(uint repayAmount) external returns (uint);
}

interface Comptroller {
    function getAllMarkets() external returns (ICToken[] memory);

    function enterMarkets(address[] calldata) external returns (uint256[] memory);

    function claimComp(address holder) external;
}

contract CompoundV2YieldFarm is IFlashLoanRecipient {

    struct State {
        address depositAddress;
        address collateralAddress;
        uint256 totalAmount;
        // uint256 rate;
        address swapAddress;
        address borrowAddress;
        uint24 poolFee;
        bool isDeposited;
    }

    struct Amounts {
        uint256 flashLoan;
        uint256 total;
    }

    address payable private owner; // contract owner

    IVault private vault;

    ISwapRouter private swapRouter;

    State private state;

    modifier onlyOwner() {
        require(msg.sender == owner, 'caller is not the owner!');
        _;
    }

    constructor(address _vault, address _swapRouter) public {
        owner = payable(msg.sender);

        vault = IVault(_vault);
        swapRouter = ISwapRouter(_swapRouter);
    }

    fallback() external payable {
        revert();
    }

    function calcAmounts(uint256 amount, uint256 rate) private returns (Amounts memory) {
        uint256 totalAmount = (amount * 100) / rate;
        uint256 flashLoanAmount = totalAmount - amount;

        return Amounts({ total: totalAmount, flashLoan: flashLoanAmount });
    }

    function makeFlashLoan(IERC20[] memory tokens, uint256[] memory amounts, bytes memory userData) internal {
        vault.flashLoan(this, tokens, amounts, userData);
    }

    function enterMarkets(address _comptroller, address _market) external onlyOwner returns (bool) {
        address[] memory markets = new address[](1);
        markets[0] = address(_market);
        uint256[] memory errors = Comptroller(_comptroller).enterMarkets(markets);

        if (errors[0] != 0) {
            revert(string.concat('Comptroller error code: ', Strings.toString(errors[0])));
        }

        return true;
    }

    function claim(address _comptroller, address _token, string memory _func) external onlyOwner returns (bool) {
        IERC20 token = IERC20(_token);

        address(_comptroller).call(abi.encodeWithSignature(_func, address(this)));
        token.transfer(owner, token.balanceOf(address(this)));

        return true;
    }

    function withdrawToken(address _token) external onlyOwner returns (bool) {
        IERC20 token = IERC20(_token);
        token.transfer(owner, token.balanceOf(address(this)));

        return true;
    }

    function swap(
        address _tokenIn,
        address _tokenOut,
        uint256 _amount,
        uint24 _poolFee
    ) private returns (uint256) {
        IERC20 tokenIn = IERC20(_tokenIn);
        uint256 balance = tokenIn.balanceOf(address(this));

        tokenIn.approve(address(swapRouter), balance);

        ISwapRouter.ExactOutputSingleParams memory params =
        ISwapRouter.ExactOutputSingleParams({
            tokenIn: _tokenIn,
            tokenOut: _tokenOut,
            fee: _poolFee,
            recipient: address(this),
            deadline: block.timestamp,
            amountOut: _amount,
            amountInMaximum: balance,
            sqrtPriceLimitX96: 0
        });

        uint256 amountIn = swapRouter.exactOutputSingle(params);

        if (amountIn < _amount) {
            tokenIn.approve(address(swapRouter), 0);
            tokenIn.transfer(address(this), balance - amountIn);
        }

        return amountIn;
    }

    function depositToProtocol(
        address _depositAddress,
        address _collateralAddress,
        uint256 _amount,
        uint256 _rate,
        address _swapAddress,
        address _borrowAddress,
        uint24 _poolFee
    ) private returns (bool) {
        require(state.isDeposited == false, 'Withdraw first');

        bytes memory data;
        IERC20[] memory tokens = new IERC20[](1);
        uint256[] memory amounts = new uint256[](1);
        Amounts memory params = calcAmounts(_amount, _rate);

        tokens[0] = IERC20(_depositAddress);
        amounts[0] = params.flashLoan;

        state = State({
            depositAddress: _depositAddress,
            collateralAddress: _collateralAddress,
            totalAmount: params.total,
        // rate: _rate,
            swapAddress: _swapAddress,
            borrowAddress: _borrowAddress,
            poolFee: _poolFee,
            isDeposited: true
        });

        data = abi.encode(state);

        makeFlashLoan(tokens, amounts, data);

        return true;
    }

    function deposit(
        address _token,
        address _collateralAddress,
        uint256 _amount,
        uint256 _rate
    ) external onlyOwner returns (bool) {
        return depositToProtocol(_token, _collateralAddress, _amount, _rate, _token, _collateralAddress, 0);
    }

    function depositWithSwap(
        address _token,
        address _collateralAddress,
        uint256 _amount,
        uint256 _rate,
        address _swapAddress,
        address _borrowAddress,
        uint24 _poolFee
    ) external onlyOwner returns (bool) {
        return depositToProtocol(_token, _collateralAddress, _amount, _rate, _swapAddress, _borrowAddress, _poolFee);
    }

    function withdraw() external onlyOwner returns (bool) {
        require(state.isDeposited == true, 'Deposit first');

        bytes memory data;
        IERC20[] memory tokens = new IERC20[](1);
        uint256[] memory amounts = new uint256[](1);
        ICToken borrowToken = ICToken(state.borrowAddress);
        uint256 borrowedAmount = borrowToken.borrowBalanceCurrent(address(this));

        tokens[0] = IERC20(state.swapAddress);
        amounts[0] = borrowedAmount;

        data = abi.encode(
            State({
                depositAddress: state.depositAddress,
                collateralAddress: state.collateralAddress,
                totalAmount: state.totalAmount,
            // rate: state.rate,
                swapAddress: state.swapAddress,
                borrowAddress: state.borrowAddress,
                poolFee: state.poolFee,
                isDeposited: false
            })
        );

        makeFlashLoan(tokens, amounts, data);

        return true;
    }

    function receiveFlashLoan(
        IERC20[] memory tokens,
        uint256[] memory amounts,
        uint256[] memory feeAmounts,
        bytes memory userData
    ) external override {
        require(msg.sender == address(vault));

        State memory data = abi.decode(userData, (State));

        IERC20Extented depositToken = IERC20Extented(data.depositAddress);
        ICToken collateralToken = ICToken(data.collateralAddress);
        uint256 totalAmount = data.totalAmount;
        IERC20Extented swapToken = IERC20Extented(data.swapAddress);
        ICToken borrowToken = ICToken(data.borrowAddress);
        uint24 poolFee = data.poolFee;
        bool isDeposited = data.isDeposited;

        uint256 repayAmount = amounts[0] + feeAmounts[0];

        if (isDeposited == true) {
            depositToken.approve(address(collateralToken), totalAmount);
            collateralToken.mint(totalAmount);

            if (collateralToken != borrowToken) {
                uint256 swapAmount = repayAmount + (repayAmount / uint256(10000) * uint256(50)); // 0.5%

                uint code = borrowToken.borrow(swapAmount / (10 ** (depositToken.decimals() - swapToken.decimals())));

                swap(address(swapToken), address(depositToken), repayAmount, poolFee);
            } else {
                borrowToken.borrow(repayAmount);
            }

            depositToken.transfer(address(vault), repayAmount); // repay
        }

        if (isDeposited == false) {
            swapToken.approve(address(borrowToken), repayAmount);
            borrowToken.repayBorrow(repayAmount);
            collateralToken.redeem(collateralToken.balanceOf(address(this)));

            if (collateralToken != borrowToken) {
                uint256 swapAmount = repayAmount - swapToken.balanceOf((address(this)));
                swap(address(depositToken), address(swapToken), swapAmount, poolFee);
            }

            swapToken.transfer(address(vault), repayAmount);

            depositToken.transfer(owner, depositToken.balanceOf(address(this)));

            state = State({
                depositAddress: address(0),
                collateralAddress: address(0),
                totalAmount: 0,
            // rate: 0,
                swapAddress: address(0),
                borrowAddress: address(0),
                poolFee: 0,
                isDeposited: false
            });
        }
    }
}

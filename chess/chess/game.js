// ======== Three.js Initialization ========
const canvasContainer = document.getElementById('canvas-container');
const scene = new THREE.Scene();

// Subtle background color matching CSS theme
scene.background = new THREE.Color(0x0f172a);
// Add deep fog for depth effect
scene.fog = new THREE.FogExp2(0x0f172a, 0.015);

const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 1000);
// Initial camera position for White's perspective
camera.position.set(0, 15, 20);

// WebGL Renderer with Shadow Map support and anti-aliasing
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(window.devicePixelRatio);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
// Soft tone mapping for cinematic lighting
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
canvasContainer.appendChild(renderer.domElement);

const controls = new THREE.OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.05;
controls.maxPolarAngle = Math.PI / 2 - 0.05; // Don't go below board

// ======== Lighting ========
const ambientLight = new THREE.AmbientLight(0xffffff, 0.4);
scene.add(ambientLight);

const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
dirLight.position.set(20, 30, 10);
dirLight.castShadow = true;
dirLight.shadow.mapSize.width = 2048;
dirLight.shadow.mapSize.height = 2048;
dirLight.shadow.camera.near = 0.5;
dirLight.shadow.camera.far = 100;
dirLight.shadow.camera.left = -15;
dirLight.shadow.camera.right = 15;
dirLight.shadow.camera.top = 15;
dirLight.shadow.camera.bottom = -15;
dirLight.shadow.bias = -0.0005;
scene.add(dirLight);

const pointLight = new THREE.PointLight(0x3b82f6, 0.5, 50);
pointLight.position.set(-10, 10, -10);
scene.add(pointLight);

// ======== Materials ========
// Using MeshPhysicalMaterial for premium glass/ceramic look
const boardDarkMat = new THREE.MeshPhysicalMaterial({ 
    color: 0x1e293b, 
    roughness: 0.2, 
    metalness: 0.1,
    clearcoat: 0.8,
    clearcoatRoughness: 0.2
});
const boardLightMat = new THREE.MeshPhysicalMaterial({ 
    color: 0x94a3b8, 
    roughness: 0.4, 
    metalness: 0.1,
    clearcoat: 0.5,
});

const pieceWhiteMat = new THREE.MeshPhysicalMaterial({
    color: 0xffffff,
    roughness: 0.1,
    metalness: 0.1,
    clearcoat: 1.0,
    clearcoatRoughness: 0.1,
    transmission: 0.1, // Slight glass effect
});

const pieceBlackMat = new THREE.MeshPhysicalMaterial({
    color: 0x09090b,
    roughness: 0.2,
    metalness: 0.6,
    clearcoat: 0.8,
    clearcoatRoughness: 0.2,
});

const highlightMat = new THREE.MeshLambertMaterial({ 
    color: 0x3b82f6, 
    transparent: true, 
    opacity: 0.6,
    emissive: 0x3b82f6,
    emissiveIntensity: 0.5
});
const selectedMat = new THREE.MeshLambertMaterial({ 
    color: 0x8b5cf6, 
    transparent: true, 
    opacity: 0.8,
    emissive: 0x8b5cf6,
    emissiveIntensity: 0.5
});

// ======== Game State ========
const SQUARE_SIZE = 2;
const offset = (8 * SQUARE_SIZE) / 2 - (SQUARE_SIZE / 2); // To center the board at 0,0,0
let boardGroup = new THREE.Group();
let piecesGroup = new THREE.Group();
let markersGroup = new THREE.Group(); // Highlights for valid moves
scene.add(boardGroup);
scene.add(piecesGroup);
scene.add(markersGroup);

let squares = [];     // 64 square meshes
let chessPieces = {}; // map rank+file (e.g. "e2") to piece Object3D
let currentFen = "";
let selectedSquare = null;
let validMoveTargets = [];

// Base URL for API
const game = new Chess();

// ======== Game Mode & AI State ========
let gameMode = 'pve'; // 'pve' or 'pvp'
let aiDifficulty = 50;
let playerColor = 'w'; // For now, player is always white in PVE
let isAiThinking = false;
let stockfish = null;

// Initialize Stockfish Web Worker
try {
    const stockfishUrl = 'https://cdnjs.cloudflare.com/ajax/libs/stockfish.js/10.0.2/stockfish.js';
    const blob = new Blob([`importScripts('${stockfishUrl}');`], {type: 'application/javascript'});
    stockfish = new Worker(URL.createObjectURL(blob));
    
    stockfish.onmessage = function(event) {
        // Parse best move from stockfish: e.g. "bestmove e7e5 ponder d2d4"
        const line = event.data;
        if (line && line.startsWith('bestmove')) {
            const match = line.match(/^bestmove\s([a-h][1-8])([a-h][1-8])([qrbn])?/);
            if (match) {
                const source = match[1];
                const target = match[2];
                const promo = match[3];
                
                isAiThinking = false;
                executeMove(source, target, promo);
            }
        }
    };
    stockfish.postMessage("uci");
    stockfish.postMessage("isready");
} catch (e) {
    console.error("Failed to load Stockfish Web Worker.", e);
}

// ======== Procedural Geometry Generation ========
// To avoid loading external assets, we use LatheGeometry to create simple, elegant shapes for pieces
function createPieceMesh(type, colorMat) {
    let points = [];
    const group = new THREE.Group();
    let yOffset = 0;

    // Base for all pieces
    const baseGeo = new THREE.CylinderGeometry(0.7, 0.8, 0.4, 32);
    const baseMesh = new THREE.Mesh(baseGeo, colorMat);
    baseMesh.position.y = 0.2;
    baseMesh.castShadow = true;
    baseMesh.receiveShadow = true;
    group.add(baseMesh);
    
    // Simplistic representations using geometric primitives
    switch (type.toLowerCase()) {
        case 'p': // Pawn
            const pawnBody = new THREE.CylinderGeometry(0.3, 0.6, 1.2, 32);
            const pawnMesh = new THREE.Mesh(pawnBody, colorMat);
            pawnMesh.position.y = 1.0;
            const pawnHead = new THREE.SphereGeometry(0.4, 32, 32);
            const pHeadMesh = new THREE.Mesh(pawnHead, colorMat);
            pHeadMesh.position.y = 1.6;
            group.add(pawnMesh, pHeadMesh);
            break;
        case 'r': // Rook
            const rookBody = new THREE.CylinderGeometry(0.6, 0.6, 1.5, 32);
            const rookMesh = new THREE.Mesh(rookBody, colorMat);
            rookMesh.position.y = 1.15;
            const rookTop = new THREE.CylinderGeometry(0.7, 0.6, 0.4, 8); // Crenellations roughly
            const rTopMesh = new THREE.Mesh(rookTop, colorMat);
            rTopMesh.position.y = 2.0;
            group.add(rookMesh, rTopMesh);
            break;
        case 'n': // Knight (approximate with slanted cylinders)
            const knightBody = new THREE.CylinderGeometry(0.4, 0.6, 1.5, 32);
            const knightMesh = new THREE.Mesh(knightBody, colorMat);
            knightMesh.position.y = 1.15;
            const knightHead = new THREE.BoxGeometry(0.6, 0.8, 1.0);
            const kHeadMesh = new THREE.Mesh(knightHead, colorMat);
            kHeadMesh.position.y = 1.8;
            kHeadMesh.position.z = 0.2;
            kHeadMesh.rotation.x = -Math.PI/6;
            group.add(knightMesh, kHeadMesh);
            break;
        case 'b': // Bishop
            const bishopBody = new THREE.CylinderGeometry(0.3, 0.6, 1.8, 32);
            const bishopMesh = new THREE.Mesh(bishopBody, colorMat);
            bishopMesh.position.y = 1.3;
            const bishopHead = new THREE.SphereGeometry(0.4, 32, 32);
            bishopHead.scale(1, 1.5, 1);
            const bHeadMesh = new THREE.Mesh(bishopHead, colorMat);
            bHeadMesh.position.y = 2.4;
            const bishopTop = new THREE.SphereGeometry(0.1, 16, 16);
            const bTopMesh = new THREE.Mesh(bishopTop, colorMat);
            bTopMesh.position.y = 2.9;
            group.add(bishopMesh, bHeadMesh, bTopMesh);
            break;
        case 'q': // Queen
            const queenBody = new THREE.CylinderGeometry(0.4, 0.7, 2.2, 32);
            const queenMesh = new THREE.Mesh(queenBody, colorMat);
            queenMesh.position.y = 1.5;
            const queenCrown = new THREE.CylinderGeometry(0.8, 0.4, 0.5, 12);
            const qCrownMesh = new THREE.Mesh(queenCrown, colorMat);
            qCrownMesh.position.y = 2.8;
            const queenCrownTop = new THREE.SphereGeometry(0.2, 16, 16);
            const qTopMesh = new THREE.Mesh(queenCrownTop, colorMat);
            qTopMesh.position.y = 3.1;
            group.add(queenMesh, qCrownMesh, qTopMesh);
            break;
        case 'k': // King
            const kingBody = new THREE.CylinderGeometry(0.4, 0.7, 2.4, 32);
            const kingMesh = new THREE.Mesh(kingBody, colorMat);
            kingMesh.position.y = 1.6;
            const kingCrown = new THREE.CylinderGeometry(0.7, 0.4, 0.4, 32);
            const kCrownMesh = new THREE.Mesh(kingCrown, colorMat);
            kCrownMesh.position.y = 3.0;
            
            // Cross
            const crossV = new THREE.BoxGeometry(0.2, 0.6, 0.1);
            const cVMesh = new THREE.Mesh(crossV, colorMat);
            cVMesh.position.y = 3.5;
            const crossH = new THREE.BoxGeometry(0.5, 0.2, 0.1);
            const cHMesh = new THREE.Mesh(crossH, colorMat);
            cHMesh.position.y = 3.5;
            
            group.add(kingMesh, kCrownMesh, cVMesh, cHMesh);
            break;
    }

    // Enable shadows for all parts
    group.traverse(child => {
        if (child.isMesh) {
            child.castShadow = true;
            child.receiveShadow = true;
        }
    });

    group.pieceType = type;
    return group;
}

// ======== Scene Setup ========

function getRankFileFromIndices(col, row) {
    const files = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
    const rank = 8 - row; // row 0 is rank 8 in FEN structure visual top, but usually index 0 is rank 1. Let's adjust based on coordinate system.
    // Three.js coord: x right, z forward (towards user). Let's say White is at +z, Black is at -z.
    // So row 0 (z=-offset) is Rank 8. row 7 (z=+offset) is Rank 1.
    return files[col] + rank;
}

function getPosFromIndices(col, row) {
    return {
        x: (col * SQUARE_SIZE) - offset,
        z: (row * SQUARE_SIZE) - offset
    };
}

function initBoard() {
    // Optional: Add a subtle base border for the board
    const borderGeo = new THREE.BoxGeometry(SQUARE_SIZE * 8 + 1, 0.5, SQUARE_SIZE * 8 + 1);
    const borderMat = new THREE.MeshPhysicalMaterial({ color: 0x333333, roughness: 0.5 });
    const borderMesh = new THREE.Mesh(borderGeo, borderMat);
    borderMesh.position.y = -0.3;
    borderMesh.receiveShadow = true;
    boardGroup.add(borderMesh);

    const squareGeo = new THREE.BoxGeometry(SQUARE_SIZE, 0.2, SQUARE_SIZE);
    
    for (let row = 0; row < 8; row++) {
        for (let col = 0; col < 8; col++) {
            const isDark = (row + col) % 2 !== 0; // standard chess coloring
            const material = isDark ? boardDarkMat : boardLightMat;
            
            const squareMesh = new THREE.Mesh(squareGeo, material.clone());
            const pos = getPosFromIndices(col, row);
            
            squareMesh.position.set(pos.x, 0, pos.z);
            squareMesh.receiveShadow = true;
            
            squareMesh.userData = {
                squareName: getRankFileFromIndices(col, row),
                originalMaterial: material,
                pos: pos
            };
            
            boardGroup.add(squareMesh);
            squares.push(squareMesh);
        }
    }
}

// Parse FEN string and render pieces
function updateBoardFromFEN(fen, isInitialLoad = false) {
    const boardState = fen.split(' ')[0];
    const rows = boardState.split('/');
    
    // Determine what pieces should exist
    let newPiecesDict = {};
    for (let row = 0; row < 8; row++) {
        let col = 0;
        const rowData = rows[row];
        for (let i = 0; i < rowData.length; i++) {
            const char = rowData[i];
            if (isNaN(char)) {
                const squareName = getRankFileFromIndices(col, row);
                newPiecesDict[squareName] = char;
                col++;
            } else {
                col += parseInt(char);
            }
        }
    }

    // 1. Remove pieces that are no longer on the board or changed type
    for (const sq in chessPieces) {
        if (!newPiecesDict[sq] || newPiecesDict[sq] !== chessPieces[sq].userData.piece) {
            piecesGroup.remove(chessPieces[sq]);
            delete chessPieces[sq];
        }
    }

    // 2. Add or place new pieces
    for (const sq in newPiecesDict) {
        const char = newPiecesDict[sq];
        
        if (!chessPieces[sq]) {
            // New piece on this square
            const isWhite = char === char.toUpperCase();
            const material = isWhite ? pieceWhiteMat : pieceBlackMat;
            const mesh = createPieceMesh(char, material);
            
            const col = sq.charCodeAt(0) - 97; // 'a'=97
            const row = 8 - parseInt(sq[1]);
            const pos = getPosFromIndices(col, row);
            
            mesh.position.set(pos.x, 0, pos.z);
            if (char.toLowerCase() === 'n') {
                mesh.rotation.y = isWhite ? Math.PI : 0;
            }
            mesh.userData = { squareName: sq, piece: char };
            
            if (isInitialLoad) {
                mesh.position.y = 5;
                mesh.userData.targetY = 0;
                mesh.userData.animSpeed = 0.1 + Math.random() * 0.1;
            }
            
            chessPieces[sq] = mesh;
            piecesGroup.add(mesh);
        }
    }
}

// ======== Interactions ========
const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();

function onMouseClick(event) {
    // Prevent clicking if modal is open
    const modal = document.getElementById('startup-modal');
    if (modal.style.display !== 'none' && modal.style.opacity !== '0') return;

    // Only accept left clicks
    if (event.button !== 0) return;

    // Calculate mouse position in normalized device coordinates (-1 to +1)
    mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
    mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;

    raycaster.setFromCamera(mouse, camera);

    // 1. Check if clicking on a valid move target marker
    const markerIntersects = raycaster.intersectObjects(markersGroup.children);
    if (markerIntersects.length > 0) {
        const targetSquare = markerIntersects[0].object.userData.squareName;
        makeMove(selectedSquare, targetSquare);
        return;
    }

    // 2. Check if clicking on a piece
    const pieceIntersects = raycaster.intersectObjects(piecesGroup.children, true);
    if (pieceIntersects.length > 0) {
        // Find the root group of the piece
        let pieceObj = pieceIntersects[0].object;
        while (!pieceObj.userData.squareName && pieceObj.parent) {
            pieceObj = pieceObj.parent;
        }
        
        const squareName = pieceObj.userData.squareName;
        
        // If we already selected a piece and click an enemy piece that is a valid move target (capture)
        if (validMoveTargets.includes(squareName)) {
            makeMove(selectedSquare, squareName);
            return;
        }
        
        selectSquare(squareName);
        return;
    }

    // 3. Clear selection if clicking empty space/board
    clearSelection();
}

window.addEventListener('click', onMouseClick, false);

function selectSquare(squareName) {
    // Prevent selection if game is over, or if it's AI's turn
    if (game.game_over()) return;
    if (gameMode === 'pve' && game.turn() !== playerColor) return;
    if (isAiThinking) return;

    if (selectedSquare === squareName) {
        clearSelection();
        return;
    }

    selectedSquare = squareName;
    
    // Highlight selected piece square (visual only)
    highlightSquareForSelection(squareName);

    // Fetch legal moves for this piece
    const moves = game.moves({ square: squareName, verbose: true });
    validMoveTargets = moves.map(m => m.to);
    drawMoveMarkers();
}

function clearSelection() {
    selectedSquare = null;
    validMoveTargets = [];
    
    // Reset board materials
    squares.forEach(sq => {
        sq.material = sq.userData.originalMaterial;
    });

    // Clear markers
    while(markersGroup.children.length > 0) {
        markersGroup.remove(markersGroup.children[0]);
    }
}

function highlightSquareForSelection(squareName) {
    // Reset all
    squares.forEach(sq => { sq.material = sq.userData.originalMaterial; });
    
    const squareMesh = squares.find(sq => sq.userData.squareName === squareName);
    if (squareMesh) {
        squareMesh.material = selectedMat;
    }
}

function drawMoveMarkers() {
    // Clear existing
    while(markersGroup.children.length > 0) {
        markersGroup.remove(markersGroup.children[0]);
    }

    validMoveTargets.forEach(targetName => {
        const sqMatch = squares.find(sq => sq.userData.squareName === targetName);
        if (sqMatch) {
            // Check if there is a piece on the target (capture)
            const isCapture = chessPieces[targetName] !== undefined;

            if (isCapture) {
                // Draw a ring around the target piece
                const ringGeo = new THREE.TorusGeometry(SQUARE_SIZE * 0.4, 0.05, 16, 32);
                const ringMat = new THREE.MeshBasicMaterial({ color: 0xef4444 }); // Red for capture
                const ringMatch = new THREE.Mesh(ringGeo, ringMat);
                ringMatch.rotation.x = Math.PI / 2;
                ringMatch.position.copy(sqMatch.position);
                ringMatch.position.y = 0.15;
                ringMatch.userData.squareName = targetName;
                markersGroup.add(ringMatch);
            } else {
                // Draw a simple disk for move target
                const markerGeo = new THREE.CylinderGeometry(SQUARE_SIZE * 0.2, SQUARE_SIZE * 0.2, 0.1, 32);
                const markerMesh = new THREE.Mesh(markerGeo, highlightMat);
                markerMesh.position.copy(sqMatch.position);
                markerMesh.position.y = 0.15;
                markerMesh.userData.squareName = targetName;
                markersGroup.add(markerMesh);
            }
        }
    });
}

function updateUI(data) {
    const turnIndicator = document.getElementById('turn-indicator');
    const statusMsg = document.getElementById('status-message');

    if (data.turn === 'white') {
        turnIndicator.textContent = "White's Turn";
        turnIndicator.className = 'turn-white';
        // Rotate camera slowly to white side eventually?
    } else {
        turnIndicator.textContent = "Black's Turn";
        turnIndicator.className = 'turn-black';
    }

    if (data.is_game_over) {
        let msg = "Game Over!";
        if (data.is_checkmate) msg = `Checkmate - ${data.turn === 'white' ? 'Black' : 'White'} Wins!`;
        else if (data.is_stalemate) msg = "Draw by Stalemate!";
        statusMsg.textContent = msg;
        statusMsg.style.color = '#ef4444'; // Error/Red color
    } else if (data.is_check) {
        statusMsg.textContent = "Check!";
        statusMsg.style.color = '#eab308'; // Warning/Yellow
    } else {
        statusMsg.textContent = "";
    }
}

// ======== Game State Logic ========

function fetchGameState() {
    currentFen = game.fen();
    updateBoardFromFEN(currentFen, true);
    updateUI({
        fen: currentFen,
        turn: game.turn() === 'w' ? 'white' : 'black',
        is_game_over: game.game_over(),
        is_check: game.in_check(),
        is_checkmate: game.in_checkmate(),
        is_stalemate: game.in_stalemate()
    });
}

function triggerAiMove() {
    if (!stockfish || game.game_over()) return;
    
    isAiThinking = true;
    
    // Map 0-100 difficulty to Stockfish Skill Level (0-20)
    const skillLevel = Math.round((aiDifficulty / 100) * 20);
    stockfish.postMessage(`setoption name Skill Level value ${skillLevel}`);
    
    // Set position
    stockfish.postMessage(`position fen ${game.fen()}`);
    
    // Limit search depth based on difficulty to enforce mistakes at lower levels
    let depth = 1;
    if (aiDifficulty > 20) depth = 3;
    if (aiDifficulty > 50) depth = 8;
    if (aiDifficulty > 80) depth = 12;
    if (aiDifficulty === 100) depth = 15;
    
    stockfish.postMessage(`go depth ${depth}`);
}

function makeMove(source, target) {
    const isPawnPromotion = chessPieces[source]?.userData.piece.toLowerCase() === 'p' && 
                            (target[1] === '8' || target[1] === '1');
    const promotion = isPawnPromotion ? 'q' : undefined;

    executeMove(source, target, promotion);
}

function executeMove(source, target, promotion) {
    const move = game.move({
        from: source,
        to: target,
        promotion: promotion
    });

    if (move) {
        clearSelection();
        
        const pieceMesh = chessPieces[source];
        const targetMesh = chessPieces[target];
        
        // Start sliding animation locally before full FEN sync
        if (targetMesh && targetMesh !== pieceMesh) {
            piecesGroup.remove(targetMesh);
            delete chessPieces[target];
        }

        // Handle En Passant immediate removal
        if (move.flags.includes('e')) {
            const epSquare = target[0] + source[1]; // target is e.g. d6, source is e5, captured piece is d5
            const epMesh = chessPieces[epSquare];
            if (epMesh) {
                piecesGroup.remove(epMesh);
                delete chessPieces[epSquare];
            }
        }
        
        if (pieceMesh) {
            const col = target.charCodeAt(0) - 97;
            const row = 8 - parseInt(target[1]);
            const pos = getPosFromIndices(col, row);
            
            pieceMesh.userData.targetX = pos.x;
            pieceMesh.userData.targetZ = pos.z;
            
            delete chessPieces[source];
            pieceMesh.userData.squareName = target;
            chessPieces[target] = pieceMesh;
        }

        // Handle Castling Rook Slide
        if (move.flags.includes('k') || move.flags.includes('q')) {
            let rookSource, rookTarget;
            if (target === 'g1') { rookSource = 'h1'; rookTarget = 'f1'; }
            else if (target === 'c1') { rookSource = 'a1'; rookTarget = 'd1'; }
            else if (target === 'g8') { rookSource = 'h8'; rookTarget = 'f8'; }
            else if (target === 'c8') { rookSource = 'a8'; rookTarget = 'd8'; }

            if (rookSource && rookTarget && chessPieces[rookSource]) {
                const rookMesh = chessPieces[rookSource];
                const rCol = rookTarget.charCodeAt(0) - 97;
                const rRow = 8 - parseInt(rookTarget[1]);
                const rPos = getPosFromIndices(rCol, rRow);
                
                rookMesh.userData.targetX = rPos.x;
                rookMesh.userData.targetZ = rPos.z;
                
                delete chessPieces[rookSource];
                rookMesh.userData.squareName = rookTarget;
                chessPieces[rookTarget] = rookMesh;
            }
        }
        
        currentFen = game.fen();
        // Delay full FEN sync to allow slide animation
        setTimeout(() => {
            updateBoardFromFEN(currentFen, false);
        }, 300);
        
        updateUI({
            fen: currentFen,
            turn: game.turn() === 'w' ? 'white' : 'black',
            is_game_over: game.game_over(),
            is_check: game.in_check(),
            is_checkmate: game.in_checkmate(),
            is_stalemate: game.in_stalemate()
        });

        // Trigger AI move if it's PVE and AI's turn
        if (gameMode === 'pve' && game.turn() !== playerColor && !game.game_over()) {
            setTimeout(triggerAiMove, 500); // Small delay for visual pacing
        }
        
    } else {
        console.error("Move error: Invalid move");
        clearSelection();
    }
}

function resetGame() {
    game.reset();
    isAiThinking = false;
    clearSelection();
    fetchGameState();
}

// ======== Modal & UI Listeners ========

const modal = document.getElementById('startup-modal');
const modePveBtn = document.getElementById('mode-pve');
const modePvpBtn = document.getElementById('mode-pvp');
const diffWrapper = document.getElementById('difficulty-wrapper');
const diffSlider = document.getElementById('difficulty-slider');
const diffValue = document.getElementById('diff-value');
const startGameBtn = document.getElementById('start-game-btn');

modePveBtn.addEventListener('click', () => {
    gameMode = 'pve';
    modePveBtn.classList.add('active');
    modePvpBtn.classList.remove('active');
    diffWrapper.style.opacity = '1';
    diffWrapper.style.pointerEvents = 'auto';
});

modePvpBtn.addEventListener('click', () => {
    gameMode = 'pvp';
    modePvpBtn.classList.add('active');
    modePveBtn.classList.remove('active');
    diffWrapper.style.opacity = '0';
    diffWrapper.style.pointerEvents = 'none';
});

diffSlider.addEventListener('input', (e) => {
    aiDifficulty = parseInt(e.target.value);
    diffValue.textContent = aiDifficulty;
});

startGameBtn.addEventListener('click', () => {
    modal.style.opacity = '0';
    setTimeout(() => {
        modal.style.display = 'none';
    }, 300);
    resetGame();
});

document.getElementById('menu-btn').addEventListener('click', () => {
    modal.style.display = 'flex';
    // Small delay to allow display flex to apply before opacity transition
    setTimeout(() => {
        modal.style.opacity = '1';
    }, 10);
});

// ======== Event Listeners ========
window.addEventListener('resize', onWindowResize, false);
function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
}

document.getElementById('reset-btn').addEventListener('click', resetGame);
document.getElementById('cam-reset').addEventListener('click', () => {
    // Reset camera position smoothly (could use tweening here, simple hard jump for now)
    camera.position.set(0, 15, 20);
    controls.target.set(0,0,0);
});

// ======== Render Loop ========
function animate() {
    requestAnimationFrame(animate);

    controls.update();

    // Simple procedural animation for piece "falling" or "sliding" into place
    piecesGroup.children.forEach(mesh => {
        if (mesh.userData.targetY !== undefined) {
            if (mesh.position.y > mesh.userData.targetY) {
                mesh.position.y -= mesh.userData.animSpeed;
                if (mesh.position.y <= mesh.userData.targetY) {
                    mesh.position.y = mesh.userData.targetY;
                    delete mesh.userData.targetY;
                }
            }
        }
        if (mesh.userData.targetX !== undefined && mesh.userData.targetZ !== undefined) {
            const dx = mesh.userData.targetX - mesh.position.x;
            const dz = mesh.userData.targetZ - mesh.position.z;
            mesh.position.x += dx * 0.2;
            mesh.position.z += dz * 0.2;
            if (Math.abs(dx) < 0.05 && Math.abs(dz) < 0.05) {
                mesh.position.x = mesh.userData.targetX;
                mesh.position.z = mesh.userData.targetZ;
                delete mesh.userData.targetX;
                delete mesh.userData.targetZ;
            }
        }
    });

    // Make markers pulse
    const time = Date.now() * 0.003;
    highlightMat.opacity = 0.4 + Math.sin(time) * 0.2;
    markersGroup.children.forEach(marker => {
        if (marker.geometry.type === "TorusGeometry") {
            // spin capture rings
            marker.rotation.z += 0.05;
        }
    });

    renderer.render(scene, camera);
}

// Initialize
initBoard();
fetchGameState(); // Initial render for background view
animate();

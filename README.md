# TSP Solver - React

A web application built with React to visualize and solve the Traveling Salesperson Problem (TSP).

This project provides an interactive interface for users to define a set of "cities" on a 2D plane and then run various algorithms to find the shortest possible route that visits each city exactly once and returns to the origin city.

![image](https://placehold.co/600x400/EEE/31343C?text=TSP%20Solver%20Screenshot)

## ✨ Features

*   **Interactive Canvas**: Add, move, or remove cities directly on the map.
*   **Algorithm Visualization**: Watch in real-time as algorithms work to find the optimal path.
*   **Multiple Algorithms**: Compare the results of different TSP-solving algorithms (e.g., Nearest Neighbor, 2-Opt, etc.).
*   **Performance Metrics**: View the total distance of the calculated path and the time taken to compute it.
*   **Public Transport Routing**: Use Google Maps Directions API to compute routes using public transportation (bus, train, subway) via the new "Transit" travel mode.
*   **Responsive Design**: Works on a wide range of screen sizes.

## 🔑 API Key Requirements

This application integrates with external mapping and routing services that require API keys:

*   **OpenRouteService API key**: Required for driving, walking, and cycling modes. Get your free key at [openrouteservice.org](https://openrouteservice.org/).
*   **Google Maps API key**: Required for transit mode (public transport). Get your key at [Google Cloud Console](https://console.cloud.google.com/).

Both API keys are stored locally in your browser and never sent to any server other than the respective API providers.

## 🛠️ Tech Stack

*   **Frontend**: [React](https://reactjs.org/)
*   **Bundler**: [esbuild](https://esbuild.github.io/)
*   **Transpiler**: [Babel](https://babeljs.io/)
*   **Language**: JavaScript/TypeScript

## 🚀 Getting Started

Follow these instructions to get a copy of the project up and running on your local machine for development and testing purposes.

### API Keys Setup (Required for Routing Features)

To enable routing features that use real-world location data, you need to configure API keys:

1. **Google Maps API key** (for transit mode):
   - Visit [Google Cloud Console](https://console.cloud.google.com/)
   - Create a new project or select an existing one
   - Enable the "Directions API" and "Maps JavaScript API"
   - Create an API key and copy it

2. **OpenRouteService API key** (for driving/walking/cycling modes):
   - Visit [OpenRouteService](https://openrouteservice.org/)
   - Sign up for a free account
   - Navigate to your dashboard and copy your API key

Once you have your API keys, they will be stored in your browser's localStorage when you enter them in the application settings.

### Prerequisites

You need to have [Node.js](https://nodejs.org/en/) (which includes npm) installed on your system.

### Installation

1.  **Clone the repository:**

    ```sh
    git clone https://github.com/your-username/tsp_solver_react.git
    cd tsp_solver_react
    ```

2.  **Install dependencies:**

    Using npm:
    ```sh
    npm install
    ```

    Or using yarn:
    ```sh
    yarn install
    ```

### Running the Application

To start the development server:

```sh
npm start
```

This will run the app in development mode. Open [http://localhost:3000](http://localhost:3000) to view it in your browser. The page will reload when you make changes.

## 📦 Available Scripts

In the project directory, you can run:

*   `npm start`: Runs the app in development mode.
*   `npm run build`: Builds the app for production to the `build` folder.
*   `npm test`: Launches the test runner in interactive watch mode.

## 🤝 Contributing

Contributions are what make the open-source community such an amazing place to learn, inspire, and create. Any contributions you make are **greatly appreciated**.

Please fork the repo and create a pull request. You can also simply open an issue with the tag "enhancement".

## 📄 License

Distributed under the MIT License. See `LICENSE` file for more information.
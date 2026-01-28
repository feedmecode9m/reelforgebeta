# Step 1: Build the Svelte app
FROM node:18-alpine as build-stage
WORKDIR /app

# Note: We point to the 'frontend' folder where your package.json lives
COPY frontend/package*.json ./
RUN npm install
COPY frontend/ .
RUN npm run build

# Step 2: Serve with Nginx
FROM nginx:stable-alpine
# Copy the build output to Nginx's html folder
COPY --from=build-stage /app/dist /usr/share/nginx/html
# Copy our custom Nginx config to fix CORS
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]

\# Congressional Research App



A comprehensive web application for exploring Congressional data including members, legislation, and committees. Built with React frontend and Node.js/Express backend, using PostgreSQL database populated with data from the Congress.gov API.



\## 🌟 Features



\- \*\*Browse Members\*\*: Search and filter members of Congress with detailed profiles

\- \*\*Explore Legislation\*\*: Search bills, resolutions, and track their progress

\- \*\*Committee Information\*\*: View committee details, reports, and related legislation

\- \*\*Responsive Design\*\*: Works seamlessly on desktop and mobile devices

\- \*\*Real-time Data\*\*: Populated with current data from Congress.gov API



\## 🏗️ Architecture



\- \*\*Frontend\*\*: React with modern CSS (no external dependencies)

\- \*\*Backend\*\*: Node.js with Express.js REST API

\- \*\*Database\*\*: PostgreSQL with comprehensive schema

\- \*\*Data Source\*\*: Congress.gov API v3



\## 📋 Prerequisites



Before you begin, ensure you have the following installed:

\- \[Node.js](https://nodejs.org/) (v14 or higher)

\- \[PostgreSQL](https://www.postgresql.org/) (v12 or higher)

\- \[Git](https://git-scm.com/)



\## 🚀 Installation \& Setup



\### 1. Clone the Repository

```bash

git clone https://github.com/yourusername/congressional-research-app.git

cd congressional-research-app

```



\### 2. Install Dependencies



\*\*Backend dependencies:\*\*

```bash

npm install pg dotenv node-fetch express cors

```



\*\*Frontend dependencies:\*\*

```bash

npx create-react-app frontend

cd frontend

npm install lucide-react

\# Copy App.js and App.css to frontend/src/

cd ..

```



\### 3. Database Setup



\*\*Create PostgreSQL database:\*\*

```sql

CREATE DATABASE congress\_data;

CREATE USER congress\_user WITH PASSWORD 'your\_password';

GRANT ALL PRIVILEGES ON DATABASE congress\_data TO congress\_user;

```



\*\*Run the database schema setup:\*\*

```bash

node dbSetup.js

```



\### 4. Environment Configuration



Create a `.env` file in the root directory:

```env

\# Database Configuration

DB\_USER=congress\_user

DB\_HOST=localhost

DB\_NAME=congress\_data

DB\_PASSWORD=your\_password

DB\_PORT=5432



\# Congress.gov API Configuration

CONGRESS\_API\_KEY=your\_api\_key\_here

CURRENT\_CONGRESS=119



\# Server Configuration

PORT=3001

```



\*\*Getting a Congress.gov API Key:\*\*

1\. Visit \[api.congress.gov](https://api.congress.gov/)

2\. Sign up for a free API key

3\. Add it to your `.env` file



\### 5. Data Population



\*\*Important\*\*: Data population can take several hours due to API rate limits.



```bash

\# Populate members data (fastest)

node memberDataPopulation.js



\# Populate committee data

node committeDataPopulation.js



\# Populate bill data (slowest - can take hours)

node billDataPopulation.js

```



\### 6. Start the Application



\*\*Terminal 1 - Backend Server:\*\*

```bash

node server.js

```



\*\*Terminal 2 - Frontend (in frontend directory):\*\*

```bash

cd frontend

npm start

```



The application will be available at `http://localhost:3000`



\## 📁 Project Structure



```

congressional-research-app/

├── dbSetup.js                 # Database schema creation

├── memberDataPopulation.js    # Member data fetcher

├── committeDataPopulation.js  # Committee data fetcher

├── billDataPopulation.js      # Bill data fetcher (heavy)

├── server.js                  # Express.js backend server

├── App.js                     # React frontend component

├── App.css                    # Application styles

├── .env                       # Environment variables (create this)

├── .gitignore                 # Git ignore rules

├── package.json               # Node.js dependencies

└── README.md                  # This file

```



\## 🔧 Configuration



\### API Rate Limits

The Congress.gov API has rate limits. The data population scripts include:

\- Automatic retry logic for rate limit errors

\- Intelligent batching to minimize API calls

\- Sleep delays between requests



\### Database Considerations

\- Initial data population requires ~2-4 hours for full dataset

\- Database will consume ~500MB-1GB for complete 119th Congress data

\- Scripts check for recently updated data to avoid unnecessary re-processing



\## 📊 Database Schema



The application uses a comprehensive PostgreSQL schema with the following main tables:

\- `members` - Congressional members and biographical data

\- `bills` - Legislation with full details and relationships

\- `committees` - Committee structure and history

\- `bill\_actions` - Legislative action timeline

\- Plus many more relational tables for complete data modeling



\## 🚀 Deployment Options



\### Quick Deploy (Database Required)

This app requires a PostgreSQL database with populated data. For deployment:



1\. \*\*Set up production database\*\* (PostgreSQL on cloud provider)

2\. \*\*Run data population scripts\*\* on production database

3\. \*\*Deploy backend\*\* (Heroku, Railway, DigitalOcean, etc.)

4\. \*\*Deploy frontend\*\* (Vercel, Netlify, etc.)

5\. \*\*Update environment variables\*\* for production



\### Development vs Production

\- \*\*Development\*\*: Local PostgreSQL + local API server

\- \*\*Production\*\*: Cloud PostgreSQL + deployed API server



\## 🤝 Contributing



1\. Fork the repository

2\. Create a feature branch (`git checkout -b feature/amazing-feature`)

3\. Commit your changes (`git commit -m 'Add some amazing feature'`)

4\. Push to the branch (`git push origin feature/amazing-feature`)

5\. Open a Pull Request



\## ⚠️ Important Notes



\- \*\*Data Population Time\*\*: Allow 2-4 hours for complete data population

\- \*\*API Key Required\*\*: You must obtain a free Congress.gov API key

\- \*\*Database Dependency\*\*: This app will not function without a populated PostgreSQL database

\- \*\*Memory Usage\*\*: Data population scripts are memory-intensive for bill processing



\## 📝 License



This project is open source and available under the \[MIT License](LICENSE).



\## 🆘 Troubleshooting



\### Common Issues:



\*\*"Failed to fetch" errors:\*\*

\- Ensure your backend server is running on port 3001

\- Check that your database connection is working

\- Verify your Congress.gov API key is valid



\*\*Empty data:\*\*

\- Run the data population scripts in order: members → committees → bills

\- Check your `.env` file configuration

\- Ensure your database user has proper permissions



\*\*Slow performance:\*\*

\- Bill data population is intentionally slow due to API rate limits

\- Consider populating data overnight or during low-usage periods

\- Monitor your API key's daily rate limit



\## 📧 Contact



If you have questions or need help with setup, please open an issue in this repository.



---



\*\*Note\*\*: This application is for educational and research purposes. It is not affiliated with the U.S. Congress or Congress.gov.

